-- Compatible with existing protocol-4 clients. Apply before the updated client.
alter function public.kelime_apply_v4(jsonb) rename to kelime_apply_v4_internal;
revoke all on function public.kelime_apply_v4_internal(jsonb) from public,anon,authenticated;

create function public.kelime_apply_v4(p_operation jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); message text;
begin
  if owner_id is null or p_operation->>'accountId' is distinct from owner_id::text then
    raise exception 'Authentication required for this account' using errcode='42501';
  end if;
  insert into public.profiles(id) values(owner_id) on conflict do nothing;
  -- The v4 pronunciation CAS and receipt lookup must share the lower-layer lock.
  perform 1 from public.profiles where id=owner_id for update;
  return public.kelime_apply_v4_internal(p_operation);
exception when sqlstate 'P0001' then
  get stacked diagnostics message=message_text;
  if message in (
    'Session already exists or is not new', 'This session is archived',
    'A different answer was already accepted. Your alternative is retained as a conflict.',
    'Session changed. The first accepted answer is authoritative; your alternative is retained.',
    'This session changed on another device. Your draft is retained for review.',
    'An imported session changed; refresh migration preview',
    'Imported session identity has conflicting results',
    'Account values changed. Your device action is saved for review.',
    'Account changed during migration preview. Keep account data and create a fresh preview.',
    'This device dataset was already imported. Keep account data; your backup is retained.',
    'A different answer was already recorded',
    'Finish the existing session first',
    'Finish the practice session before deleting this word',
    'Deleted words cannot be restored',
    'Finish or archive every saved session containing this word before deleting it'
  ) or message like 'Account data changed%' then
    -- Preserve the existing RPC conflict result contract for older PWA clients.
    return jsonb_build_object('conflict',true,'message',message,'snapshot',public.kelime_snapshot());
  end if;
  raise exception '%',message using errcode='KS422';
end $$;

create function public.kelime_reconcile(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); accepted jsonb;
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  insert into public.profiles(id) values(owner_id) on conflict do nothing;
  perform 1 from public.profiles where id=owner_id for update;
  select coalesce(jsonb_agg(id),'[]'::jsonb) into accepted
    from public.operation_receipts where user_id=owner_id and id=any(p_ids);
  return jsonb_build_object('accepted',accepted,'snapshot',public.kelime_snapshot());
end $$;
revoke all on function public.kelime_apply_v4(jsonb),public.kelime_reconcile(uuid[]) from public,anon,authenticated;
grant execute on function public.kelime_apply_v4(jsonb),public.kelime_reconcile(uuid[]) to authenticated;

-- Safely collapse obsolete legacy drafts under the same account lock as apply.
-- Receipts retire every original ID atomically, including late/lost-response retries.
create function public.kelime_compact_drafts(p_operations jsonb,p_batch uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); first_op jsonb; last_op jsonb; previous_op jsonb;
  item jsonb; c jsonb; merged jsonb; result jsonb; ids uuid[];
begin
  if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
  if jsonb_typeof(p_operations)<>'array' or jsonb_array_length(p_operations)<2 then
    raise exception 'Expected draft chain' using errcode='KS422';
  end if;
  insert into public.profiles(id) values(owner_id) on conflict do nothing;
  perform 1 from public.profiles where id=owner_id for update;
  select array_agg((x->>'id')::uuid) into ids from jsonb_array_elements(p_operations) x;
  if p_batch is null or p_batch=any(ids) or cardinality(ids)<>(select count(distinct x) from unnest(ids) x) then
    raise exception 'Draft operation IDs must be unique' using errcode='KS422';
  end if;
  if exists(select 1 from public.operation_receipts where user_id=owner_id and id=any(ids)) then
    return public.kelime_reconcile(ids);
  end if;
  first_op:=p_operations->0;
  for item in select * from jsonb_array_elements(p_operations) loop
    if item->>'kind'<>'draft' or item->>'accountId' is distinct from owner_id::text
      or item->'changes' is null or jsonb_typeof(item->'changes')<>'array'
      or exists(select 1 from jsonb_array_elements(item->'changes') x where x->>'key' not like 'session/%' and x->>'key' not like 'session-record/%') then
      raise exception 'Only a contiguous session draft chain may be compacted' using errcode='KS422';
    end if;
    if previous_op is not null then
      if jsonb_array_length(item->'changes')<>jsonb_array_length(previous_op->'changes') or exists(
        select 1 from jsonb_array_elements(item->'changes') x
        where not exists(select 1 from jsonb_array_elements(previous_op->'changes') y where y->>'key'=x->>'key' and y->'after'=x->'before')
      ) then raise exception 'Draft chain is discontinuous' using errcode='KS422'; end if;
    end if;
    -- Every intermediate transition must change draft text only.
    for c in select * from jsonb_array_elements(item->'changes') loop
      if c->>'key' like 'session-record/%' then
        if (c->'before') #- '{practice,draft}' is distinct from (c->'after') #- '{practice,draft}' then
          raise exception 'Draft changes persistent session fields' using errcode='KS422';
        end if;
      elsif c->>'key'='session/review' then
        if (c->'before') #- '{practice,draft}' is distinct from (c->'after') #- '{practice,draft}' then
          raise exception 'Draft changes persistent session fields' using errcode='KS422';
        end if;
      elsif (c->'before')-'draft' is distinct from (c->'after')-'draft' then
        raise exception 'Draft changes persistent session fields' using errcode='KS422';
      end if;
    end loop;
    previous_op:=item;
  end loop;
  last_op:=previous_op;
  select jsonb_agg(jsonb_build_object('key',x->>'key','before',y->'before','after',x->'after')) into merged
    from jsonb_array_elements(last_op->'changes') x join jsonb_array_elements(first_op->'changes') y on x->>'key'=y->>'key';
  begin
    result:=public.kelime_apply_v4(last_op||jsonb_build_object('id',p_batch,'changes',merged));
  exception when sqlstate 'KS409' or sqlstate 'KS422' then
    return jsonb_build_object('accepted','[]'::jsonb,'snapshot',public.kelime_snapshot());
  end;
  if coalesce((result->>'conflict')::boolean,false) then
    return jsonb_build_object('accepted','[]'::jsonb,'snapshot',public.kelime_snapshot());
  end if;
  insert into public.operation_receipts(user_id,id) select owner_id,unnest(ids) on conflict do nothing;
  return public.kelime_reconcile(ids);
end $$;
revoke all on function public.kelime_compact_drafts(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.kelime_compact_drafts(jsonb,uuid) to authenticated;
