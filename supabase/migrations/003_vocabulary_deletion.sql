-- Apply after 002_events.sql. Adds protocol 3 bulk vocabulary management.
create table public.hidden_builtin_vocabulary (
 user_id uuid not null references public.profiles(id) on delete cascade,
 vocabulary_id integer not null check(vocabulary_id>=0),
 hidden boolean not null default true,
 archived_state jsonb not null default '{}'::jsonb,
 updated_at timestamptz not null default now(), revision bigint not null default 0,
 primary key(user_id,vocabulary_id)
);
alter table public.hidden_builtin_vocabulary enable row level security;
create policy own_hidden_builtin on public.hidden_builtin_vocabulary for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.hidden_builtin_vocabulary from public,anon,authenticated;
grant select on public.hidden_builtin_vocabulary to authenticated;
alter table public.profiles add column reset_epoch bigint not null default 0;

alter function public.kelime_apply_v2(jsonb) rename to kelime_apply_v2_internal;
revoke all on function public.kelime_apply_v2_internal(jsonb) from public,anon,authenticated;
create function public.kelime_apply_v2(p_operation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if exists(select 1 from public.profiles where id=auth.uid() and sync_protocol>=3) then raise exception 'Update Kelime before syncing. Older queued changes are preserved for migration.'; end if;
 return public.kelime_apply_v2_internal(p_operation);
end $$;

create function public.kelime_snapshot_v3() returns jsonb language sql security definer set search_path='' as $$ select public.kelime_snapshot() $$;
create function public.kelime_apply_v3(p_operation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid();op uuid:=(p_operation->>'id')::uuid;kind text:=p_operation->>'kind';c jsonb;k text;v jsonb;old jsonb;rev bigint;ref text;result jsonb;filtered jsonb;h jsonb;favorite boolean;deadline timestamptz;
begin
 if owner_id is null or p_operation->>'accountId' is distinct from owner_id::text then raise exception 'Authentication required for this account' using errcode='42501'; end if;
 if op is null or jsonb_typeof(p_operation->'changes')<>'array' then raise exception 'Invalid operation'; end if;
 insert into public.profiles(id) values(owner_id) on conflict do nothing;
 select revision into rev from public.profiles where id=owner_id for update;
 if exists(select 1 from public.operation_receipts where user_id=owner_id and id=op) then return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot()); end if;
 if kind='migration' and exists(select 1 from jsonb_array_elements(p_operation->'changes') x where x->>'key' like 'hidden/%' or x->>'key' like 'hidden-state/%') then
  for c in select * from jsonb_array_elements(p_operation->'changes') x where x->>'key' like 'hidden/%' or x->>'key' like 'hidden-state/%' loop
   k:=c->>'key';v:=c->'after';ref:=split_part(k,'/',2);select value into old from public.account_records where user_id=owner_id and key=k;
   if coalesce(old,'null'::jsonb) is distinct from c->'before' then return jsonb_build_object('conflict',true,'message','Hidden vocabulary changed during migration. Refresh the preview.','snapshot',public.kelime_snapshot()); end if;
   insert into public.account_records(user_id,key,value,revision) values(owner_id,k,v,rev+1) on conflict(user_id,key) do update set value=v,revision=rev+1,updated_at=now();
   if k like 'hidden/b:%' and v='true'::jsonb then insert into public.hidden_builtin_vocabulary(user_id,vocabulary_id,hidden,revision) values(owner_id,substring(ref from 3)::integer,true,rev+1) on conflict(user_id,vocabulary_id) do update set hidden=true,revision=rev+1,updated_at=now();
   elsif k like 'hidden-state/b:%' then insert into public.hidden_builtin_vocabulary(user_id,vocabulary_id,archived_state,revision) values(owner_id,substring(ref from 3)::integer,v,rev+1) on conflict(user_id,vocabulary_id) do update set archived_state=v,revision=rev+1,updated_at=now(); end if;
  end loop;
  select coalesce(jsonb_agg(x),'[]'::jsonb) into filtered from jsonb_array_elements(p_operation->'changes') x where x->>'key' not like 'hidden/%' and x->>'key' not like 'hidden-state/%';
  result:=public.kelime_apply_v2_internal(jsonb_set(p_operation,'{changes}',filtered));update public.profiles set sync_protocol=3 where id=owner_id;return result;
 end if;
 if kind not in ('bulk-delete','restore','clear-user','reset-progress','clear-all') then
  result:=public.kelime_apply_v2_internal(p_operation);
  update public.profiles set sync_protocol=3 where id=owner_id;
  return result;
 end if;
 -- One optimistic batch: every before value must still match before any row changes.
 for c in select * from jsonb_array_elements(p_operation->'changes') loop
  k:=c->>'key';select value into old from public.account_records where user_id=owner_id and key=k;
  if coalesce(old,'null'::jsonb) is distinct from c->'before' then return jsonb_build_object('conflict',true,'message','Account data changed. Review this vocabulary command before retrying.','snapshot',public.kelime_snapshot()); end if;
  if k !~ '^(word|deleted|suppressed|hidden|hidden-state|archived-word|progress|favorite|setting|activity|session|session-record)/' then raise exception 'Unsupported account record'; end if;
 end loop;
 rev:=rev+1;
 for c in select * from jsonb_array_elements(p_operation->'changes') loop
  k:=c->>'key';v:=c->'after';ref:=split_part(k,'/',2);
  if v='null'::jsonb then delete from public.account_records where user_id=owner_id and key=k;
  else insert into public.account_records(user_id,key,value,revision) values(owner_id,k,v,rev) on conflict(user_id,key) do update set value=excluded.value,revision=rev,updated_at=now(); end if;
  if k like 'hidden/b:%' then
   if v='true'::jsonb then insert into public.hidden_builtin_vocabulary(user_id,vocabulary_id,hidden,revision) values(owner_id,substring(ref from 3)::integer,true,rev) on conflict(user_id,vocabulary_id) do update set hidden=true,revision=rev,updated_at=now();delete from public.learning_progress where user_id=owner_id and vocabulary_source='builtin' and vocabulary_id=substring(ref from 3);
   else delete from public.hidden_builtin_vocabulary where user_id=owner_id and vocabulary_id=substring(ref from 3)::integer; end if;
  elsif k like 'hidden-state/b:%' and v<>'null'::jsonb then
   insert into public.hidden_builtin_vocabulary(user_id,vocabulary_id,archived_state,revision) values(owner_id,substring(ref from 3)::integer,v,rev) on conflict(user_id,vocabulary_id) do update set archived_state=v,revision=rev,updated_at=now();
  elsif k like 'deleted/u:%' and v='true'::jsonb then
   update public.user_vocabulary set deleted_at=now(),updated_at=now(),revision=rev where user_id=owner_id and id=substring(ref from 3)::uuid;
   delete from public.learning_progress where user_id=owner_id and vocabulary_source='user' and vocabulary_id=substring(ref from 3);
  elsif k like 'session-record/%' and v->'archivedAt' is not null then
   update public.test_sessions set archived_at=public.kelime_time(v->'archivedAt'),updated_at=now(),revision=rev where user_id=owner_id and id=substring(k from 16)::uuid;
  end if;
 end loop;
 for ref in select distinct split_part(x->>'key','/',2) from jsonb_array_elements(p_operation->'changes') x where x->>'key' like 'progress/%' or x->>'key' like 'favorite/%' loop
  if ref like 'b:%' and exists(select 1 from public.hidden_builtin_vocabulary where user_id=owner_id and vocabulary_id=substring(ref from 3)::integer and hidden) then continue; end if;
  if ref like 'u:%' and exists(select 1 from public.account_records where user_id=owner_id and key='deleted/'||ref and value='true'::jsonb) then continue; end if;
  select value into h from public.account_records where user_id=owner_id and key='progress/'||ref;select coalesce(value='true'::jsonb,false) into favorite from public.account_records where user_id=owner_id and key='favorite/'||ref;favorite:=coalesce(favorite,false);
  if h is null or h='null'::jsonb then insert into public.learning_progress(user_id,vocabulary_id,vocabulary_source,favorite,revision) values(owner_id,substring(ref from 3),case when ref like 'b:%' then 'builtin' else 'user' end,favorite,rev) on conflict(user_id,vocabulary_source,vocabulary_id) do update set favorite=excluded.favorite,revision=rev,updated_at=now();
  else perform public.kelime_stats(h);perform public.kelime_stats(h->'englishToTurkish');perform public.kelime_stats(h->'turkishToEnglish');deadline:=least(public.kelime_deadline(h->'englishToTurkish'),public.kelime_deadline(h->'turkishToEnglish'));if (h->>'legacyReviewPending')::boolean and (h->>'learned')::boolean then deadline:=now();end if;
   insert into public.learning_progress(user_id,vocabulary_id,vocabulary_source,favorite,learned,needs_review,times_tested,times_known,times_missed,consecutive_known,last_tested_at,last_known_at,next_review_at,english_to_turkish_stats,turkish_to_english_stats,revision) values(owner_id,substring(ref from 3),case when ref like 'b:%' then 'builtin' else 'user' end,favorite,(h->>'learned')::boolean,coalesce(deadline<=now(),false),(h->>'timesTested')::integer,(h->>'timesKnown')::integer,(h->>'timesMissed')::integer,(h->>'consecutiveKnown')::integer,public.kelime_time(h->'lastTestedAt'),public.kelime_time(h->'lastKnownAt'),deadline,h->'englishToTurkish',h->'turkishToEnglish',rev) on conflict(user_id,vocabulary_source,vocabulary_id) do update set favorite=excluded.favorite,learned=excluded.learned,needs_review=excluded.needs_review,times_tested=excluded.times_tested,times_known=excluded.times_known,times_missed=excluded.times_missed,consecutive_known=excluded.consecutive_known,last_tested_at=excluded.last_tested_at,last_known_at=excluded.last_known_at,next_review_at=excluded.next_review_at,english_to_turkish_stats=excluded.english_to_turkish_stats,turkish_to_english_stats=excluded.turkish_to_english_stats,revision=rev,updated_at=now();
  end if;
 end loop;
 if kind in ('clear-user','reset-progress','clear-all') then
  update public.user_vocabulary set deleted_at=now(),updated_at=now(),revision=rev where user_id=owner_id and deleted_at is null;
  delete from public.learning_progress where user_id=owner_id and vocabulary_source='user';
 end if;
 if kind in ('reset-progress','clear-all') then
  delete from public.hidden_builtin_vocabulary where user_id=owner_id;
  delete from public.builtin_overrides where user_id=owner_id;
  delete from public.learning_progress where user_id=owner_id;
  update public.profiles set reset_epoch=reset_epoch+1 where id=owner_id;
 end if;
 if kind='clear-all' then
  delete from public.assessment_events where user_id=owner_id;
  delete from public.test_sessions where user_id=owner_id;
  delete from public.account_records where user_id=owner_id and key not like 'deleted/%' and key not in ('setting/goal','setting/mode');
 end if;
 insert into public.operation_receipts(user_id,id) values(owner_id,op);
 update public.profiles set revision=rev,sync_protocol=3 where id=owner_id;
 return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot());
end $$;
revoke all on function public.kelime_apply_v2(jsonb),public.kelime_apply_v3(jsonb),public.kelime_apply_v2_internal(jsonb),public.kelime_snapshot_v3() from public,anon,authenticated;
grant execute on function public.kelime_apply_v2(jsonb),public.kelime_apply_v3(jsonb),public.kelime_snapshot_v3() to authenticated;
