-- Apply after 005. Compact evidence and explicit review requests use existing
-- account_records, RLS, profile locks and operation receipts. No chat storage.
alter function public.kelime_apply_v4(jsonb) rename to kelime_apply_v4_compat;
revoke all on function public.kelime_apply_v4_compat(jsonb) from public,anon,authenticated;
create function public.kelime_apply_v4(p_operation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 perform 1 from public.profiles where id=auth.uid() for update;
 if exists(select 1 from public.profiles where id=auth.uid() and sync_protocol>=5) then raise exception 'Update Kelime before syncing. Older queued changes are preserved.' using errcode='KS422'; end if;
 return public.kelime_apply_v4_compat(p_operation);
end $$;
create function public.kelime_snapshot_v5() returns jsonb language plpgsql security definer set search_path='' as $$
declare s jsonb; e bigint;
begin
 s:=public.kelime_snapshot();select reset_epoch into e from public.profiles where id=auth.uid();
 return jsonb_set(s,'{cells}',(s->'cells')||jsonb_build_object('learning/epoch',e));
end $$;
create function public.kelime_ai_evidence(owner_id uuid,v jsonb) returns void language plpgsql set search_path='' as $$
declare w jsonb; ref text;
begin
 if jsonb_typeof(v)<>'object' or v-array['id','sourceQuizId','completedAt','mode','evaluator','epoch','words']<>'{}'::jsonb
  or not (v ?& array['id','sourceQuizId','completedAt','mode','evaluator','epoch','words'])
  or exists(select 1 from unnest(array['id','mode','evaluator']) field where jsonb_typeof(v->field)<>'string')
  or v->>'evaluator'<>'mock' or v->>'mode' not in ('voiceAnswer','useTheWord','conversation')
  or jsonb_typeof(v->'completedAt')<>'number' or (v->>'completedAt')::numeric not between 0 and 8640000000000000
  or jsonb_typeof(v->'epoch')<>'number' or (v->>'epoch')::numeric not between 0 and 9007199254740991 or (v->>'epoch')::numeric<>trunc((v->>'epoch')::numeric)
  or jsonb_typeof(v->'words')<>'array' or jsonb_array_length(v->'words') not between 1 and 8 then raise exception 'Invalid compact evidence' using errcode='23514';end if;
 perform (v->>'id')::uuid; if v->'sourceQuizId'<>'null'::jsonb then perform (v->>'sourceQuizId')::uuid;end if;
 if (select count(*)<>count(distinct x->>'wordId') from jsonb_array_elements(v->'words') x) then raise exception 'Duplicate evidence word' using errcode='23514';end if;
 for w in select * from jsonb_array_elements(v->'words') loop
  if jsonb_typeof(w)<>'object' or w-array['wordId','direction','outcome','retrieval','semantic','grammar','suggested']<>'{}'::jsonb or not(w ?& array['wordId','direction','outcome','retrieval','semantic','grammar','suggested'])
   or exists(select 1 from unnest(array['wordId','direction','outcome','retrieval','semantic','grammar']) field where jsonb_typeof(w->field)<>'string')
   or w->>'direction' not in ('englishToTurkish','turkishToEnglish') or w->>'outcome' not in ('correct','partial','needsPractice','notAttempted')
   or w->>'retrieval' not in ('recognized','missing','unassessed') or w->>'semantic' not in ('acceptable','inappropriate','unassessed')
   or w->>'grammar' not in ('correct','needsCorrection','unassessed') or jsonb_typeof(w->'suggested')<>'boolean'
   or (w->>'suggested')::boolean is distinct from (w->>'outcome' in ('partial','needsPractice'))
   or w->>'outcome'='correct' and (w->>'retrieval'<>'recognized' or w->>'semantic'='inappropriate')
   or w->>'outcome'='partial' and (w->>'retrieval'<>'recognized' or w->>'semantic'<>'inappropriate')
   or w->>'outcome'='needsPractice' and w->>'retrieval'<>'missing' and w->>'semantic'<>'inappropriate'
   or w->>'outcome'='notAttempted' and (w->>'retrieval'<>'unassessed' or w->>'semantic'<>'unassessed' or w->>'grammar'<>'unassessed') then raise exception 'Invalid compact outcome' using errcode='23514';end if;
  ref:=w->>'wordId';
  -- Historical evidence may reference tombstoned personal vocabulary, but never another account.
  if ref like 'u:%' then
   if not exists(select 1 from public.user_vocabulary where user_id=owner_id and id=substring(ref from 3)::uuid) and not exists(select 1 from public.account_records where user_id=owner_id and key='deleted/'||ref and value='true'::jsonb) then raise exception 'Unknown historical vocabulary' using errcode='23514';end if;
  else perform public.kelime_reference(owner_id,ref,true);end if;
 end loop;
end $$;
create function public.kelime_merge_review(a jsonb,b jsonb) returns jsonb language plpgsql immutable set search_path='' as $$
begin
 if a is null then return b;end if;
 if (a-array['status','resolvedBy','requestedAt']) is distinct from (b-array['status','resolvedBy','requestedAt']) then raise exception 'Review request identity is immutable' using errcode='23514';end if;
 a:=a||jsonb_build_object('requestedAt',least((a->>'requestedAt')::numeric,(b->>'requestedAt')::numeric));
 if a->>'status'='cancelled' or b->>'status'='cancelled' then return (a-'resolvedBy')||'{"status":"cancelled"}'::jsonb;end if;
 if a->>'status'='resolved' or b->>'status'='resolved' then return a||jsonb_build_object('status','resolved','resolvedBy',least(a->>'resolvedBy',b->>'resolvedBy'));end if;
 return a;
end $$;
create function public.kelime_apply_v5(p_operation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); op uuid; kind text:=p_operation->>'kind'; c jsonb; v jsonb; old jsonb; e jsonb; w jsonb; k text; ref text;
 epoch bigint; rev bigint; filtered jsonb; result jsonb; event jsonb; rid text; req jsonb; source text; resolved jsonb;
begin
 if owner_id is null or p_operation->>'accountId' is distinct from owner_id::text then raise exception 'Authentication required for this account' using errcode='42501';end if;
 op:=(p_operation->>'id')::uuid;
 if op is null or jsonb_typeof(p_operation->'changes') is distinct from 'array' then raise exception 'Invalid operation' using errcode='23514';end if;
 insert into public.profiles(id) values(owner_id) on conflict do nothing;
 select reset_epoch,revision into epoch,rev from public.profiles where id=owner_id for update;
 if exists(select 1 from public.operation_receipts where user_id=owner_id and id=op) then return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot_v5());end if;
 if (select count(*)<>count(distinct x->>'key') from jsonb_array_elements(p_operation->'changes') x) then raise exception 'Duplicate record changes' using errcode='23514';end if;
 if kind in ('ai-complete','review-request') then
  if p_operation->'protocol' is distinct from '5'::jsonb or jsonb_typeof(p_operation->'learningEpoch') is distinct from 'number' or (p_operation->>'learningEpoch')::numeric<>trunc((p_operation->>'learningEpoch')::numeric) then raise exception 'AI commands require protocol 5 and an integer epoch' using errcode='23514';end if;
  if (p_operation->>'learningEpoch')::numeric is distinct from epoch::numeric then return jsonb_build_object('conflict',true,'message','Learning progress was reset. This AI action belongs to an earlier reset epoch.','snapshot',public.kelime_snapshot_v5());end if;
  if jsonb_array_length(p_operation->'changes') not between 1 and 8 then raise exception 'AI batch must contain 1 to 8 records' using errcode='23514';end if;
 end if;
 -- Reject client-owned epoch edits and inappropriate persistent namespaces.
 for c in select * from jsonb_array_elements(p_operation->'changes') loop
  k:=c->>'key';v:=c->'after';
  if kind='ai-complete' and k not like 'ai-evidence/%' or kind='review-request' and k not like 'review-request/%' then raise exception 'Invalid AI command fields' using errcode='23514';end if;
  if k='learning/epoch' and (v is distinct from to_jsonb(case when kind in ('reset-progress','clear-all') then epoch+1 else epoch end)) then raise exception 'Invalid learning epoch' using errcode='KS409';end if;
  if k like 'ai-evidence/%' and kind not in ('ai-complete','migration','reset-progress','clear-all') or k like 'review-request/%' and kind not in ('review-request','assess','migration','delete','bulk-delete','clear-user','reset-progress','clear-all') then raise exception 'Unauthorized learning record mutation' using errcode='23514';end if;
 end loop;
 -- Existing assessment/quiz transactions remain authoritative. Filter only new
 -- namespaces; the original operation identity, timestamps and payload are retained.
 select coalesce(jsonb_agg(x),'[]'::jsonb) into filtered from jsonb_array_elements(p_operation->'changes') x where x->>'key' not like 'ai-evidence/%' and x->>'key' not like 'review-request/%' and x->>'key'<>'learning/epoch';
 if kind not in ('ai-complete','review-request') then
  result:=public.kelime_apply_v4_compat(jsonb_set(p_operation,'{changes}',filtered));
  if coalesce((result->>'conflict')::boolean,false) then return jsonb_set(result,'{snapshot}',public.kelime_snapshot_v5());end if;
  select revision,reset_epoch into rev,epoch from public.profiles where id=owner_id;
 else
  rev:=rev+1;update public.profiles set revision=rev where id=owner_id;
 end if;
 if kind in ('ai-complete','migration') then
  for c in select * from jsonb_array_elements(p_operation->'changes') x where x->>'key' like 'ai-evidence/%' loop
   k:=c->>'key';v:=c->'after';perform public.kelime_ai_evidence(owner_id,v);
   if k<>'ai-evidence/'||(v->>'id') or (v->>'epoch')::bigint<>epoch then raise exception 'Invalid evidence identity or epoch' using errcode='23514';end if;
   if v->>'sourceQuizId' is not null and not exists(select 1 from public.test_sessions where user_id=owner_id and id=(v->>'sourceQuizId')::uuid and session_type='daily' and state->>'phase'='completed') then raise exception 'Evidence source must be a completed Daily Test owned by this account' using errcode='23514';end if;
   if kind='ai-complete' then
    for w in select * from jsonb_array_elements(v->'words') loop
     ref:=w->>'wordId';perform public.kelime_reference(owner_id,ref);
     if exists(select 1 from public.account_records where user_id=owner_id and key in ('deleted/'||ref,'hidden/'||ref) and value='true'::jsonb) then raise exception 'Practice word unavailable' using errcode='KS409';end if;
    end loop;
   end if;
   select value into old from public.account_records where user_id=owner_id and key=k;
   if old is not null and old is distinct from v then raise exception 'Evidence is immutable' using errcode='KS409';end if;
   insert into public.account_records(user_id,key,value,revision) values(owner_id,k,v,rev) on conflict do nothing;
  end loop;
 end if;
 if kind in ('review-request','migration') then
  for c in select * from jsonb_array_elements(p_operation->'changes') x where x->>'key' like 'review-request/%' loop
   k:=c->>'key';v:=c->'after';ref:=v->>'wordId';
   if jsonb_typeof(v)<>'object' or v-array['id','wordId','direction','requestedAt','source','sourceSessionId','epoch','status','resolvedBy']<>'{}'::jsonb
    or not(v ?& array['id','wordId','direction','requestedAt','source','sourceSessionId','epoch','status'])
    or exists(select 1 from unnest(array['id','wordId','direction','source','sourceSessionId','status']) field where jsonb_typeof(v->field)<>'string')
    or jsonb_typeof(v->'epoch')<>'number' or (v->>'epoch')::numeric<>trunc((v->>'epoch')::numeric)
    or k<>'review-request/'||(v->>'id') or v->>'source'<>'aiPractice' or v->>'direction' not in ('englishToTurkish','turkishToEnglish')
    or jsonb_typeof(v->'requestedAt')<>'number' or (v->>'requestedAt')::numeric not between 0 and 8640000000000000
    or (v->>'epoch')::bigint<>epoch or v->>'status' not in ('active','resolved','cancelled')
    or kind='review-request' and v->>'status'<>'active' then raise exception 'Invalid review request' using errcode='23514';end if;
   perform (v->>'id')::uuid;perform (v->>'sourceSessionId')::uuid;
   if v->>'status'='resolved' then perform (v->>'resolvedBy')::uuid;if v->>'resolvedBy' is null then raise exception 'Resolution requires assessment identity' using errcode='23514';end if;
   elsif v ? 'resolvedBy' then raise exception 'Unexpected resolution' using errcode='23514';end if;
   select value into e from public.account_records where user_id=owner_id and key='ai-evidence/'||(v->>'sourceSessionId');
   if e is null or not exists(select 1 from jsonb_array_elements(e->'words') t where t->>'wordId'=ref and t->>'direction'=v->>'direction' and t->'suggested'='true'::jsonb) then raise exception 'Review request requires suggested evidence' using errcode='23514';end if;
   select value into old from public.account_records where user_id=owner_id and key=k;
   if old is null and exists(select 1 from public.account_records where user_id=owner_id and key like 'review-request/%' and value->>'sourceSessionId'=v->>'sourceSessionId' and value->>'wordId'=ref and value->>'direction'=v->>'direction') then raise exception 'Suggestion already has a request identity' using errcode='KS409';end if;
   if kind='migration' and v->>'status'='resolved' and not exists(
    select 1 from public.account_records sr cross join lateral jsonb_array_elements(sr.value->'practice'->'results') answer
    where sr.user_id=owner_id and sr.key like 'session-record/%' and sr.value->>'source'='review'
      and answer->>'eventId'=v->>'resolvedBy' and answer->>'wordId'=ref and answer->>'direction'=v->>'direction'
      and coalesce(answer->'resolvedReviewRequestIds','[]'::jsonb) @> jsonb_build_array(v->>'id')
   ) and not coalesce(old->>'status'='resolved' and old->>'resolvedBy'=v->>'resolvedBy',false) then raise exception 'Imported resolution requires Review evidence' using errcode='23514';end if;
   v:=public.kelime_merge_review(old,v);
   if v->>'status'='active' then
    if exists(select 1 from public.account_records where user_id=owner_id and key in ('deleted/'||ref,'hidden/'||ref) and value='true'::jsonb) then
     if kind='migration' then v:=(v-'resolvedBy')||'{"status":"cancelled"}'::jsonb;else raise exception 'Review word unavailable' using errcode='KS409';end if;
    else perform public.kelime_reference(owner_id,ref);end if;
   end if;
   insert into public.account_records(user_id,key,value,revision) values(owner_id,k,v,rev) on conflict(user_id,key) do update set value=excluded.value,revision=excluded.revision,updated_at=now();
  end loop;
 end if;
 if kind='assess' then
  select payload into event from public.assessment_events where user_id=owner_id and operation_id=op;
  if event is not null then
   select session_type into source from public.test_sessions where user_id=owner_id and id=(select session_id from public.assessment_events where user_id=owner_id and operation_id=op);
   resolved:=coalesce(event->'resolvedReviewRequestIds','[]'::jsonb);
   if jsonb_typeof(resolved)<>'array' or (select count(*)<>count(distinct x) from jsonb_array_elements_text(resolved) x) then raise exception 'Invalid observed requests' using errcode='23514';end if;
   if jsonb_array_length(resolved)>0 and p_operation->'protocol' is distinct from '5'::jsonb then raise exception 'Observed requests require protocol 5' using errcode='23514';end if;
   if source<>'review' and jsonb_array_length(resolved)>0 then raise exception 'Only Review resolves requests' using errcode='23514';end if;
   for rid in select jsonb_array_elements_text(resolved) loop
    perform rid::uuid;select value into req from public.account_records where user_id=owner_id and key='review-request/'||rid;
    if req is null or req->>'wordId' is distinct from event->>'wordId' or req->>'direction' is distinct from event->>'direction' or (req->>'epoch')::bigint<>epoch then raise exception 'Request does not match Review assessment' using errcode='23514';end if;
    if req->>'status'<>'cancelled' then
     req:=public.kelime_merge_review(req,req||jsonb_build_object('status','resolved','resolvedBy',event->>'eventId'));
     update public.account_records set value=req,revision=rev,updated_at=now() where user_id=owner_id and key='review-request/'||rid;
    end if;
   end loop;
  end if;
 end if;
 -- Server cleanup covers requests not yet observed by the deleting device.
 if kind in ('delete','bulk-delete','clear-user','reset-progress','clear-all','migration') then
  update public.account_records r set value=(r.value-'resolvedBy')||'{"status":"cancelled"}'::jsonb,revision=rev,updated_at=now()
   where r.user_id=owner_id and r.key like 'review-request/%' and (exists(select 1 from public.account_records d where d.user_id=owner_id and d.key in ('deleted/'||(r.value->>'wordId'),'hidden/'||(r.value->>'wordId')) and d.value='true'::jsonb) or exists(select 1 from public.user_vocabulary uv where uv.user_id=owner_id and 'u:'||uv.id::text=r.value->>'wordId' and uv.deleted_at is not null));
 end if;
 if kind in ('reset-progress','clear-all') then delete from public.account_records where user_id=owner_id and (key like 'ai-evidence/%' or key like 'review-request/%');end if;
 insert into public.operation_receipts(user_id,id) values(owner_id,op) on conflict do nothing;
 update public.profiles set sync_protocol=5 where id=owner_id;
 return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot_v5());
exception when sqlstate 'KS409' then
 -- PL/pgSQL exception subtransaction rolls back all delegated mutations too.
 return jsonb_build_object('conflict',true,'message',sqlerrm,'snapshot',public.kelime_snapshot_v5());
end $$;
create function public.kelime_reconcile_v5(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare r jsonb;begin r:=public.kelime_reconcile(p_ids);return jsonb_set(r,'{snapshot}',public.kelime_snapshot_v5());end $$;

create function public.kelime_compact_drafts_v5(p_operations jsonb,p_batch uuid) returns jsonb
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
    return public.kelime_reconcile_v5(ids);
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
    result:=public.kelime_apply_v5(last_op||jsonb_build_object('id',p_batch,'changes',merged));
  exception when sqlstate 'KS409' or sqlstate 'KS422' then
    return jsonb_build_object('accepted','[]'::jsonb,'snapshot',public.kelime_snapshot_v5());
  end;
  if coalesce((result->>'conflict')::boolean,false) then
    return jsonb_build_object('accepted','[]'::jsonb,'snapshot',public.kelime_snapshot_v5());
  end if;
  insert into public.operation_receipts(user_id,id) select owner_id,unnest(ids) on conflict do nothing;
  return public.kelime_reconcile_v5(ids);
end $$;

revoke all on function public.kelime_ai_evidence(uuid,jsonb),public.kelime_merge_review(jsonb,jsonb),public.kelime_apply_v4(jsonb),public.kelime_apply_v5(jsonb),public.kelime_snapshot_v5(),public.kelime_reconcile_v5(uuid[]),public.kelime_compact_drafts_v5(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.kelime_apply_v4(jsonb),public.kelime_apply_v5(jsonb),public.kelime_snapshot_v5(),public.kelime_reconcile_v5(uuid[]),public.kelime_compact_drafts_v5(jsonb,uuid) to authenticated;
