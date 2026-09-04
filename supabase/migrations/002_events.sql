-- Apply AFTER 001_kelime.sql. No guest storage or existing aggregate is discarded.
alter table public.profiles add column sync_protocol integer not null default 1;
alter table public.test_sessions add column archived_at timestamptz;
create table public.assessment_events (
 user_id uuid not null references public.profiles(id) on delete cascade,
 id uuid not null, session_id uuid not null, question_index integer not null check(question_index>=0),
 operation_id uuid not null, accepted_order bigint generated always as identity,
 recorded_at timestamptz, activity_date date, payload jsonb not null,
 primary key(user_id,id), unique(user_id,session_id,question_index),
 foreign key(user_id,session_id) references public.test_sessions(user_id,id)
);
alter table public.assessment_events enable row level security;
create policy own_events on public.assessment_events for select to authenticated using ((select auth.uid())=user_id);
revoke all on public.assessment_events from public,anon,authenticated;
grant select on public.assessment_events to authenticated;
create index assessment_events_owner on public.assessment_events(user_id,accepted_order);
alter function public.kelime_apply(jsonb) rename to kelime_apply_legacy;
revoke all on function public.kelime_apply_legacy(jsonb) from public,anon,authenticated;
create function public.kelime_apply(p_operation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.profiles(id) values(auth.uid()) on conflict do nothing;
 perform 1 from public.profiles where id=auth.uid() for update;
 if exists(select 1 from public.profiles where id=auth.uid() and sync_protocol>=2) then raise exception 'Update Kelime before syncing. Older queued changes are preserved for migration.'; end if;
 return public.kelime_apply_legacy(p_operation);
end $$;
create function public.kelime_empty_stats() returns jsonb language sql immutable set search_path='' as $$
 select '{"timesTested":0,"timesKnown":0,"timesMissed":0,"consecutiveKnown":0,"lastTestedAt":null,"lastKnownAt":null}'::jsonb
$$;
create function public.kelime_event_stats(s jsonb, known boolean, at_ms numeric) returns jsonb language plpgsql immutable set search_path='' as $$
declare t numeric:=greatest(at_ms,(s->>'lastTestedAt')::numeric); begin
 s:=coalesce(s,public.kelime_empty_stats());
 return s||jsonb_build_object('timesTested',coalesce((s->>'timesTested')::integer,0)+1,
 'timesKnown',coalesce((s->>'timesKnown')::integer,0)+known::integer,
 'timesMissed',coalesce((s->>'timesMissed')::integer,0)+(not known)::integer,
 'consecutiveKnown',case when known then coalesce((s->>'consecutiveKnown')::integer,0)+1 else 0 end,
 'lastTestedAt',t,'lastKnownAt',case when known then to_jsonb(t) else s->'lastKnownAt' end);
end $$;
create function public.kelime_difficulty(s jsonb,at_ms numeric) returns integer language sql immutable set search_path='' as $$
 select case when coalesce((s->>'timesTested')::numeric,0)=0 then 0 else
 greatest(0,least(100,round(100*(s->>'timesMissed')::numeric/(s->>'timesTested')::numeric
 +case when (s->>'timesMissed')::integer>0 and (s->>'consecutiveKnown')::integer=0 then 15*greatest(0,1-greatest(0,at_ms-(s->>'lastTestedAt')::numeric)/604800000) else 0 end
 -least(25,5*(s->>'consecutiveKnown')::integer))))::integer end
$$;
create function public.kelime_snapshot_v2() returns jsonb language sql security definer set search_path='' as $$ select public.kelime_snapshot() $$;
create function public.kelime_apply_v2(p_operation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid:=auth.uid(); op uuid:=(p_operation->>'id')::uuid; kind text:=p_operation->>'kind';
 changes jsonb:='[]'; c jsonb; k text; old jsonb; v jsonb; r jsonb; result jsonb;
 src text; pointer text; sid uuid; before_s jsonb; next_s jsonb; existing jsonb; session_record jsonb;
 event jsonb; event_id uuid; idx integer; q jsonb; direction text; ref text; h jsonb; at_ms numeric;
 bucket jsonb; counts jsonb; source_activity jsonb; activity_key text; known boolean; score integer;
 empty_source jsonb:='{ "directions":{"englishToTurkish":{"answered":0,"correct":0,"known":0,"missed":0},"turkishToEnglish":{"answered":0,"correct":0,"known":0,"missed":0}},"completed":0,"scoreSum":0,"bestScore":null}';
 newly jsonb; needs jsonb:='[]'; hardest jsonb:='[]'; difficulty integer; level text; archived boolean:=false;
begin
 if owner_id is null or p_operation->>'accountId' is distinct from owner_id::text then raise exception 'Authentication required for this account' using errcode='42501'; end if;
 if op is null or kind not in ('vocabulary','delete','favorite','learned','preferences','start','draft','submit','assess','migration','archive') or jsonb_typeof(p_operation->'changes')<>'array' then raise exception 'Invalid operation'; end if;
 insert into public.profiles(id) values(owner_id) on conflict do nothing;
 perform 1 from public.profiles where id=owner_id for update;
 if exists(select 1 from public.operation_receipts where user_id=owner_id and id=op) then return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot()); end if;
 -- Retain old aggregates as baselines; copying session records never creates activity.
 for r in select to_jsonb(t) from public.test_sessions t where user_id=owner_id loop
  insert into public.account_records(user_id,key,value) values(owner_id,'session-record/'||(r->>'id'),jsonb_build_object('source',r->>'session_type','practice',r->'state')) on conflict do nothing;
 end loop;
 for c in select * from jsonb_array_elements(p_operation->'changes') loop
  k:=c->>'key';v:=c->'after';
  if k in ('session/daily','session/review') and kind<>'migration' and v<>'null'::jsonb then
   if sid is not null then raise exception 'One session mutation per operation'; end if;
   src:=split_part(k,'/',2); pointer:=k; next_s:=case when src='review' then v->'practice' else v end;sid:=(next_s->>'syncId')::uuid;
   before_s:=case when src='review' then c->'before'->'practice' else c->'before' end;
  end if;
  if k like 'session-record/%' and kind='archive' and v->'archivedAt' is not null then
   src:=v->>'source';pointer:='session/'||src;next_s:=v->'practice';sid:=(next_s->>'syncId')::uuid;archived:=true;before_s:=c->'before'->'practice';session_record:=v;
  end if;
 end loop;
 if kind in ('start','draft','submit','assess','archive') and sid is null then raise exception 'Legacy session change needs explicit review; no history was overwritten'; end if;
 if sid is not null then
  select c0->'before'->'practice' into r from jsonb_array_elements(p_operation->'changes') c0 where c0->>'key'='session-record/'||sid;
  if r is not null then before_s:=r; end if;
  select value into existing from public.account_records where user_id=owner_id and key='session-record/'||sid;
  if existing->>'source' is not null and existing->>'source' is distinct from src then raise exception 'Session source mismatch'; end if;
  if existing->'archivedAt' is not null then raise exception 'This session is archived'; end if;
  if kind='start' then
   if existing is not null or (next_s->>'index')::integer<>0 or next_s->>'phase'<>'answering' then raise exception 'Session already exists or is not new'; end if;
   before_s:='null';
  elsif kind='assess' then
   idx:=(before_s->>'index')::integer;event:=next_s->'results'->idx;
   if idx is null or jsonb_array_length(next_s->'results')<>idx+1 or before_s->>'phase'<>'feedback' then raise exception 'Ambiguous legacy assessment: retain for explicit review'; end if;
   event_id:=coalesce((event->>'eventId')::uuid,op);
   select payload into r from public.assessment_events where user_id=owner_id and (id=event_id or (session_id=sid and question_index=idx));
   if r is not null then
    if (r-'eventId') is distinct from (event-'eventId') then raise exception 'A different answer was already accepted. Your alternative is retained as a conflict.'; end if;
    insert into public.operation_receipts(user_id,id) values(owner_id,op);return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot());
   end if;
   if existing is null or ((existing->'practice')-array['newlyLearnedIds','completion','completedAt']) is distinct from (before_s-array['newlyLearnedIds','completion','completedAt']) then raise exception 'Session changed. The first accepted answer is authoritative; your alternative is retained.'; end if;
   before_s:=existing->'practice';
   q:=before_s->'questions'->idx;ref:=q->>'wordId';direction:=q->>'direction';
   if event->>'wordId' is distinct from ref or event->>'direction' is distinct from direction or event->'snapshot' is distinct from q->'snapshot' or event->'correct' is distinct from before_s->'submittedCorrect' or event->'answer' is distinct from before_s->'submittedAnswer' or jsonb_typeof(event->'known')<>'boolean' then raise exception 'Assessment does not match frozen feedback'; end if;
   perform public.kelime_reference(owner_id,ref);
   at_ms:=(event->>'answeredAt')::numeric;known:=(event->>'known')::boolean;
   if at_ms is null or at_ms<0 or at_ms>8640000000000000 then raise exception 'Assessment needs a valid recorded time'; end if;
   select value into h from public.account_records where user_id=owner_id and key='progress/'||ref;
   h:=coalesce(nullif(h,'null'),public.kelime_empty_stats()||jsonb_build_object('learned',false,'legacyReviewPending',false,'englishToTurkish',public.kelime_empty_stats(),'turkishToEnglish',public.kelime_empty_stats()));
   newly:=before_s->'newlyLearnedIds';
   if known and not coalesce((h->>'learned')::boolean,false) and not newly @> jsonb_build_array(ref) then newly:=newly||jsonb_build_array(ref); end if;
   at_ms:=greatest(at_ms,(h->>'lastTestedAt')::numeric);
   old:=h;h:=public.kelime_event_stats(h,known,at_ms)||jsonb_build_object(direction,public.kelime_event_stats(h->direction,known,at_ms),'learned',known or coalesce((h->>'learned')::boolean,false));
   if direction='englishToTurkish' then h:=h||jsonb_build_object('legacyReviewPending',false); end if;
   select value into old from public.account_records where user_id=owner_id and key='progress/'||ref;
   changes:=changes||jsonb_build_array(jsonb_build_object('key','progress/'||ref,'before',coalesce(old,'null'),'after',h));
   -- Reconstruct advancement from the accepted question, not client aggregate snapshots.
   next_s:=before_s||jsonb_build_object('index',idx+1,'results',(before_s->'results')||jsonb_build_array(event),'newlyLearnedIds',newly,'draft','','submittedAnswer','','submittedCorrect',null,'phase',case when idx+1=jsonb_array_length(before_s->'questions') then 'completed' else 'answering' end,'completedAt',case when idx+1=jsonb_array_length(before_s->'questions') then at_ms else null end);
   activity_key:='activity/'||coalesce(event->>'activityDate','undated');
   if activity_key<>'activity/undated' then perform (event->>'activityDate')::date; end if;
   select value into bucket from public.account_records where user_id=owner_id and key=activity_key;
   old:=coalesce(bucket,'null');bucket:=coalesce(bucket,jsonb_build_object('daily',empty_source,'review',empty_source));source_activity:=bucket->src;counts:=source_activity->'directions'->direction;
   counts:=jsonb_build_object('answered',(counts->>'answered')::integer+1,'correct',(counts->>'correct')::integer+(event->>'correct')::boolean::integer,'known',(counts->>'known')::integer+known::integer,'missed',(counts->>'missed')::integer+(not known)::integer);
   source_activity:=jsonb_set(source_activity,array['directions',direction],counts);
   if next_s->>'phase'='completed' then
    select count(*) into score from jsonb_array_elements(next_s->'results') a where (a->>'correct')::boolean;
    source_activity:=source_activity||jsonb_build_object('completed',(source_activity->>'completed')::integer+1,'scoreSum',(source_activity->>'scoreSum')::integer+case when src='daily' then score else 0 end,'bestScore',case when src='daily' then greatest(coalesce((source_activity->>'bestScore')::integer,0),score) else null end);
    for q in select * from jsonb_array_elements(next_s->'questions') loop
     if q->>'wordId'=ref then r:=h;else select value into r from public.account_records where user_id=owner_id and key='progress/'||(q->>'wordId');end if;
     if ((r->'englishToTurkish'->>'timesMissed')::integer>0 and (r->'englishToTurkish'->>'consecutiveKnown')::integer=0) or ((r->'turkishToEnglish'->>'timesMissed')::integer>0 and (r->'turkishToEnglish'->>'consecutiveKnown')::integer=0) or least(public.kelime_deadline(r->'englishToTurkish'),public.kelime_deadline(r->'turkishToEnglish'))<=public.kelime_time(to_jsonb(at_ms)) or coalesce((r->>'legacyReviewPending')::boolean,false) then needs:=needs||jsonb_build_array(q->>'wordId'); end if;
     difficulty:=public.kelime_difficulty(r->(q->>'direction'),at_ms);level:=case when coalesce((r->(q->>'direction')->>'timesTested')::integer,0)=0 then 'New' when difficulty<=25 then 'Easy' when difficulty<=50 then 'Medium' when difficulty<=75 then 'Hard' else 'Very Hard' end;
     hardest:=hardest||jsonb_build_array(jsonb_build_object('wordId',q->>'wordId','direction',q->>'direction','score',difficulty,'level',level));
    end loop;
    select jsonb_agg(x) into hardest from (select value x from jsonb_array_elements(hardest) with ordinality e(value,n) order by (value->>'score')::integer desc,n limit 3) ranked;
    next_s:=next_s||jsonb_build_object('completion',jsonb_build_object('needsReviewIds',needs,'hardest',hardest));
   end if;
   changes:=changes||jsonb_build_array(jsonb_build_object('key',activity_key,'before',old,'after',jsonb_set(bucket,array[src],source_activity)));
  else
   if existing is null or ((existing->'practice')-array['newlyLearnedIds','completion','completedAt']) is distinct from (before_s-array['newlyLearnedIds','completion','completedAt']) then raise exception 'This session changed on another device. Your draft is retained for review.'; end if;
   before_s:=existing->'practice';
   next_s:=next_s||jsonb_build_object('newlyLearnedIds',before_s->'newlyLearnedIds','completion',before_s->'completion','completedAt',before_s->'completedAt');
   if before_s->>'phase'='completed' then raise exception 'Completed summaries are immutable'; end if;
   if (next_s-array['draft','submittedAnswer','submittedCorrect','phase']) is distinct from (before_s-array['draft','submittedAnswer','submittedCorrect','phase']) then raise exception 'Invalid session transition'; end if;
   if kind='draft' and (before_s->>'phase'<>'answering' or next_s->>'phase'<>'answering') or kind='submit' and (before_s->>'phase'<>'answering' or next_s->>'phase'<>'feedback' or btrim(next_s->>'submittedAnswer')='' or jsonb_typeof(next_s->'submittedCorrect')<>'boolean') then raise exception 'Invalid feedback phase'; end if;
  end if;
 end if;
 -- Legacy imports retain explicit CAS and unknown dates. All other counters are event-owned.
 for c in select * from jsonb_array_elements(p_operation->'changes') loop
  k:=c->>'key';v:=c->'after';
  if k like 'session-record/%' then continue; end if;
  if sid is not null and k like 'session/%' then continue; end if;
  if kind<>'migration' and (k like 'activity/%' or k like 'progress/%') then
   if k='activity/start' and not exists(select 1 from public.account_records where user_id=owner_id and key=k) then null;
   elsif kind='learned' and k like 'progress/%' then
    select value into old from public.account_records where user_id=owner_id and key=k;
    h:=coalesce(nullif(old,'null'),public.kelime_empty_stats()||jsonb_build_object('learned',false,'legacyReviewPending',false,'englishToTurkish',public.kelime_empty_stats(),'turkishToEnglish',public.kelime_empty_stats()));
    c:=jsonb_build_object('key',k,'before',coalesce(old,'null'),'after',h||jsonb_build_object('learned',(v->>'learned')::boolean));
   elsif kind='delete' then null;
   elsif kind='vocabulary' and k like 'progress/%' and (v->>'timesTested')::integer=0 then
    if exists(select 1 from public.account_records where user_id=owner_id and key=k) then continue; end if;
   else continue; end if;
  end if;
  if (k like 'favorite/%' or k in ('setting/goal','setting/mode')) and kind<>'migration' then
   select value into old from public.account_records where user_id=owner_id and key=k;c:=jsonb_set(c,'{before}',coalesce(old,'null'));
  end if;
  if k like 'deleted/%' and exists(select 1 from public.account_records ar cross join lateral jsonb_array_elements(ar.value->'practice'->'questions') queued where ar.user_id=owner_id and ar.key like 'session-record/%' and ar.value->'archivedAt' is null and ar.value->'practice'->>'phase'<>'completed' and queued->>'wordId'=split_part(k,'/',2)) then raise exception 'Finish or archive every saved session containing this word before deleting it'; end if;
  changes:=changes||jsonb_build_array(c);
 end loop;
 if sid is not null then
  -- The legacy projector validates references and updates relational rows. The per-UUID
  -- record is authoritative; changing the pointer cannot overwrite other sessions.
  v:=case when src='review' and before_s<>'null'::jsonb then jsonb_build_object('version',2,'practice',before_s) else before_s end;
  insert into public.account_records(user_id,key,value) values(owner_id,pointer,coalesce(v,'null')) on conflict(user_id,key) do update set value=excluded.value;
  changes:=changes||jsonb_build_array(jsonb_build_object('key',pointer,'before',coalesce(v,'null'),'after',case when archived then 'null'::jsonb when src='review' then jsonb_build_object('version',2,'practice',next_s) else next_s end));
 end if;
 result:=public.kelime_apply_legacy(p_operation||jsonb_build_object('kind',case when kind='archive' then 'draft' else kind end,'changes',changes));
 if (result->>'conflict')::boolean then raise exception '%',result->>'message'; end if;
 if sid is not null then
  session_record:=jsonb_build_object('source',src,'practice',next_s)||case when archived then jsonb_build_object('archivedAt',p_operation->'at') else '{}'::jsonb end;
  insert into public.account_records(user_id,key,value,revision) values(owner_id,'session-record/'||sid,session_record,(result->'snapshot'->>'revision')::bigint) on conflict(user_id,key) do update set value=excluded.value,revision=excluded.revision,updated_at=now();
  if archived then update public.test_sessions set archived_at=public.kelime_time(p_operation->'at'),updated_at=now() where user_id=owner_id and id=sid; end if;
  if event is not null then insert into public.assessment_events(user_id,id,session_id,question_index,operation_id,recorded_at,activity_date,payload) values(owner_id,event_id,sid,idx,op,public.kelime_time(event->'answeredAt'),(event->>'activityDate')::date,event); end if;
 end if;
 -- Import archived and non-selected sessions as historical records, never as new events.
 if kind='migration' then
  for c in select * from jsonb_array_elements(p_operation->'changes') item where item->>'key' like 'session-record/%' loop
   k:=c->>'key';r:=c->'after';next_s:=r->'practice';sid:=(next_s->>'syncId')::uuid;src:=r->>'source';
   select value into old from public.account_records where user_id=owner_id and key=k;
   if old is not null and old is distinct from c->'before' and old is distinct from r then raise exception 'An imported session changed; refresh migration preview'; end if;
   if sid is null or k<>'session-record/'||sid or src not in ('daily','review') or next_s->>'phase' not in ('answering','feedback','completed') or jsonb_array_length(next_s->'questions')<1 or jsonb_array_length(next_s->'results')<>(next_s->>'index')::integer or (next_s->>'index')::integer>jsonb_array_length(next_s->'questions') or ((next_s->>'phase'='completed')<>((next_s->>'index')::integer=jsonb_array_length(next_s->'questions'))) then raise exception 'Invalid imported session'; end if;
   if (select count(*)<>count(distinct item->>'wordId') from jsonb_array_elements(next_s->'questions') item) then raise exception 'Repeated imported question'; end if;
   for q in select * from jsonb_array_elements(next_s->'questions') loop
    perform public.kelime_reference(owner_id,q->>'wordId',r->'archivedAt' is not null or next_s->>'phase'='completed');
    if q->>'direction' not in ('englishToTurkish','turkishToEnglish') or jsonb_array_length(q->'snapshot'->'acceptedAnswers')<1 then raise exception 'Invalid imported snapshot'; end if;
   end loop;
   insert into public.test_sessions(user_id,id,session_type,test_direction,started_at,completed_at,total_questions,known_count,missed_count,accuracy,state,archived_at)
   select owner_id,sid,src,next_s->>'mode',public.kelime_time(next_s->'startedAt'),public.kelime_time(next_s->'completedAt'),jsonb_array_length(next_s->'questions'),count(*) filter(where (a->>'known')::boolean),count(*) filter(where not (a->>'known')::boolean),case when count(*)=0 then 0 else round(100.0*count(*) filter(where (a->>'correct')::boolean)/count(*))::integer end,next_s,public.kelime_time(r->'archivedAt') from jsonb_array_elements(next_s->'results') a
   on conflict(user_id,id) do nothing;
   if exists(select 1 from public.test_sessions where user_id=owner_id and id=sid and state is distinct from next_s) then raise exception 'Imported session identity has conflicting results'; end if;
   idx:=0;
   for event in select * from jsonb_array_elements(next_s->'results') loop
    q:=next_s->'questions'->idx;ref:=q->>'wordId';
    if event->>'wordId' is distinct from ref or event->>'direction' is distinct from q->>'direction' then raise exception 'Imported answer alignment mismatch'; end if;
    insert into public.test_answers(user_id,session_id,vocabulary_id,vocabulary_source,direction,typed_answer,was_correct,self_assessment_known,answered_at,activity_date,question_index,operation_id,snapshot)
    values(owner_id,sid,substring(ref from 3),case when ref like 'b:%' then 'builtin' else 'user' end,event->>'direction',event->>'answer',(event->>'correct')::boolean,(event->>'known')::boolean,public.kelime_time(event->'answeredAt'),(event->>'activityDate')::date,idx,op,event->'snapshot') on conflict(user_id,session_id,question_index) do nothing;
    idx:=idx+1;
   end loop;
   insert into public.account_records(user_id,key,value) values(owner_id,k,r) on conflict(user_id,key) do update set value=excluded.value,updated_at=now();
  end loop;
 end if;
 -- Materialize migration sessions without recounting their baseline results.
 for r in select to_jsonb(t) from public.test_sessions t where user_id=owner_id loop
  insert into public.account_records(user_id,key,value) values(owner_id,'session-record/'||(r->>'id'),jsonb_build_object('source',r->>'session_type','practice',r->'state')) on conflict do nothing;
 end loop;
 update public.profiles set sync_protocol=2 where id=owner_id;
 return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot());
end $$;
revoke all on function public.kelime_empty_stats(),public.kelime_event_stats(jsonb,boolean,numeric),public.kelime_difficulty(jsonb,numeric),public.kelime_apply(jsonb),public.kelime_apply_v2(jsonb),public.kelime_snapshot_v2() from public,anon,authenticated;
grant execute on function public.kelime_apply(jsonb),public.kelime_apply_v2(jsonb),public.kelime_snapshot_v2() to authenticated;
