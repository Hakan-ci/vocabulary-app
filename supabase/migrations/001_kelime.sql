-- Apply once, in order, through the Supabase SQL editor or CLI migrations.
create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, created_at timestamptz not null default now(), revision bigint not null default 0);
create table public.user_vocabulary (
 id uuid primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 english text not null check(length(btrim(english))>0), english_alternatives text[] not null default '{}',
 turkish_meanings text[] not null check(cardinality(turkish_meanings)>0), part_of_speech text, example_sentence text,
 tags text[] not null default '{}', created_at timestamptz, updated_at timestamptz not null default now(), revision bigint not null default 0, deleted_at timestamptz,
 unique(user_id,id)
);
create table public.learning_progress (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
 vocabulary_id text not null, vocabulary_source text not null check(vocabulary_source in ('builtin','user')),
 favorite boolean not null default false, learned boolean not null default false, needs_review boolean not null default false,
 times_tested integer not null default 0, times_known integer not null default 0, times_missed integer not null default 0, consecutive_known integer not null default 0,
 last_tested_at timestamptz, last_known_at timestamptz, next_review_at timestamptz,
 english_to_turkish_stats jsonb not null default '{}', turkish_to_english_stats jsonb not null default '{}',
 updated_at timestamptz not null default now(), revision bigint not null default 0,
 unique(user_id,vocabulary_source,vocabulary_id),
 check(times_tested=times_known+times_missed and times_known>=0 and times_missed>=0 and consecutive_known between 0 and times_known)
);
create table public.test_sessions (
 id uuid primary key, user_id uuid not null references public.profiles(id) on delete cascade,
 session_type text not null check(session_type in ('daily','review')), test_direction text not null check(test_direction in ('englishToTurkish','turkishToEnglish','mixed')),
 started_at timestamptz, completed_at timestamptz, total_questions integer not null check(total_questions>0),
 known_count integer not null default 0, missed_count integer not null default 0, accuracy integer not null default 0 check(accuracy between 0 and 100),
 state jsonb not null, updated_at timestamptz not null default now(), revision bigint not null default 0, unique(user_id,id)
);
create table public.test_answers (
 id uuid primary key default gen_random_uuid(), user_id uuid not null, session_id uuid not null,
 vocabulary_id text not null, vocabulary_source text not null check(vocabulary_source in ('builtin','user')),
 direction text not null check(direction in ('englishToTurkish','turkishToEnglish')), typed_answer text not null,
 was_correct boolean not null, self_assessment_known boolean not null, answered_at timestamptz, activity_date date,
 question_index integer not null check(question_index>=0), operation_id uuid not null, snapshot jsonb not null,
 unique(user_id,session_id,question_index), foreign key(user_id,session_id) references public.test_sessions(user_id,id) on delete cascade
);
-- Fine-grained application records are the versioned wire format and transaction source.
-- The relational tables above are maintained in the SAME transaction; clients cannot bypass it.
create table public.account_records (user_id uuid not null references public.profiles(id) on delete cascade, key text not null, value jsonb not null, updated_at timestamptz not null default now(), revision bigint not null default 0, primary key(user_id,key));
create table public.builtin_overrides (user_id uuid not null references public.profiles(id) on delete cascade, vocabulary_id text not null, content jsonb, suppressed boolean not null default false, updated_at timestamptz not null default now(), revision bigint not null default 0, primary key(user_id,vocabulary_id));
create table public.operation_receipts (user_id uuid not null references public.profiles(id) on delete cascade, id uuid not null, created_at timestamptz not null default now(), primary key(user_id,id));
create table public.migration_receipts (user_id uuid not null references public.profiles(id) on delete cascade, id uuid not null, operation_id uuid not null, created_at timestamptz not null default now(), primary key(user_id,id));
create index user_vocabulary_owner on public.user_vocabulary(user_id);
create index test_sessions_owner on public.test_sessions(user_id,updated_at);
create index test_answers_owner on public.test_answers(user_id,session_id);

do $$ declare t text; begin
 foreach t in array array['user_vocabulary','learning_progress','test_sessions','test_answers','account_records','builtin_overrides','operation_receipts','migration_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('create policy own_rows on public.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
 end loop;
end $$;
alter table public.profiles enable row level security;
create policy own_profile on public.profiles for all to authenticated using ((select auth.uid())=id) with check ((select auth.uid())=id);
revoke all on public.profiles from anon,authenticated;
grant select on public.profiles to authenticated;

create function public.kelime_time(ms jsonb) returns timestamptz language sql immutable set search_path='' as $$
 select case when ms is null or ms='null'::jsonb then null else to_timestamp((ms #>> '{}')::double precision/1000) end
$$;
create function public.kelime_reference(owner_id uuid, ref text, historical boolean default false) returns void language plpgsql set search_path='' as $$
begin
 if ref ~ '^b:[0-9]+$' then
  if substring(ref from 3)::integer not between 0 and 149 then raise exception 'Unknown built-in ID'; end if;
 elsif ref ~ '^u:[0-9a-fA-F-]{36}$' then
  if not exists(select 1 from public.user_vocabulary where user_id=owner_id and id=substring(ref from 3)::uuid and (historical or deleted_at is null)) then raise exception 'Personal vocabulary is missing, deleted, or belongs to another account'; end if;
 else raise exception 'Invalid vocabulary reference'; end if;
end $$;
create function public.kelime_stats(s jsonb) returns void language plpgsql set search_path='' as $$
begin
 if jsonb_typeof(s)<>'object' or not(s ?& array['timesTested','timesKnown','timesMissed','consecutiveKnown','lastTestedAt','lastKnownAt']) then raise exception 'Invalid statistics'; end if;
 if (s->>'timesTested')::integer<>(s->>'timesKnown')::integer+(s->>'timesMissed')::integer or (s->>'timesKnown')::integer<0 or (s->>'timesMissed')::integer<0 or (s->>'consecutiveKnown')::integer not between 0 and (s->>'timesKnown')::integer then raise exception 'Invalid statistics counters'; end if;
 if ((s->>'timesTested')::integer=0)<>(s->'lastTestedAt'='null'::jsonb) or ((s->>'timesKnown')::integer=0)<>(s->'lastKnownAt'='null'::jsonb) then raise exception 'Invalid statistics timestamps'; end if;
 if public.kelime_time(s->'lastKnownAt')>public.kelime_time(s->'lastTestedAt') then raise exception 'Invalid statistics order'; end if;
end $$;
create function public.kelime_deadline(s jsonb) returns timestamptz language sql immutable set search_path='' as $$
 select case when (s->>'timesMissed')::integer>0 and (s->>'consecutiveKnown')::integer=0 then public.kelime_time(s->'lastTestedAt')
 else public.kelime_time(s->'lastKnownAt') + make_interval(days=>case when (s->>'consecutiveKnown')::integer>=4 then 14 when (s->>'consecutiveKnown')::integer=3 then 7 when (s->>'consecutiveKnown')::integer=2 then 3 else 1 end) end
$$;
create function public.kelime_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); result jsonb;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 insert into public.profiles(id) values(owner_id) on conflict do nothing;
 select jsonb_build_object('ownerId',owner_id,'revision',p.revision,'cells',coalesce((select jsonb_object_agg(r.key,r.value) from public.account_records r where r.user_id=owner_id and r.value<>'null'::jsonb),'{}'::jsonb)) into result from public.profiles p where p.id=owner_id;
 return result;
end $$;

create function public.kelime_apply(p_operation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 owner_id uuid:=auth.uid(); op_id uuid:=(p_operation->>'id')::uuid; migration_id uuid; rev bigint;
 change jsonb; k text; v jsonb; old jsonb; ref text; word_id text; source text; h jsonb; favorite boolean; deadline timestamptz;
 session_value jsonb; previous_session jsonb; s_id uuid; answer jsonb; q jsonb; i integer; known integer; correct integer; total integer;
begin
 if owner_id is null then raise exception 'Authentication required' using errcode='42501'; end if;
 if p_operation->>'accountId' is distinct from owner_id::text then raise exception 'Account identity changed' using errcode='42501'; end if;
 if op_id is null or p_operation->>'kind' not in ('vocabulary','delete','favorite','learned','preferences','start','draft','submit','assess','migration') or jsonb_typeof(p_operation->'changes')<>'array' then raise exception 'Invalid operation'; end if;
 insert into public.profiles(id) values(owner_id) on conflict do nothing;
 select revision into rev from public.profiles where id=owner_id for update;
 if exists(select 1 from public.operation_receipts where user_id=owner_id and id=op_id) then return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot()); end if;
 if p_operation->>'kind'='migration' then
  migration_id:=(p_operation->>'migrationId')::uuid;
  if migration_id is null then raise exception 'Missing migration identity'; end if;
  if exists(select 1 from public.migration_receipts where user_id=owner_id and id=migration_id) then
   return jsonb_build_object('conflict',true,'message','This device dataset was already imported. Keep account data; your backup is retained.','snapshot',public.kelime_snapshot());
  end if;
  if (p_operation->>'expectedRevision')::bigint is distinct from rev then return jsonb_build_object('conflict',true,'message','Account changed during migration preview. Keep account data and create a fresh preview.','snapshot',public.kelime_snapshot()); end if;
 end if;
 if (select count(*)<>count(distinct c->>'key') from jsonb_array_elements(p_operation->'changes') c) then raise exception 'Duplicate record changes'; end if;
 for change in select * from jsonb_array_elements(p_operation->'changes') loop
  k:=change->>'key';
  if k !~ '^(word|progress|favorite|deleted)/(b:[0-9]+|u:[0-9a-fA-F-]{36})$' and k !~ '^suppressed/b:[0-9]+$' and k not in ('setting/goal','setting/mode','session/daily','session/review','activity/start','activity/undated') and k !~ '^activity/[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception 'Invalid record key'; end if;
  select value into old from public.account_records where user_id=owner_id and key=k;
  if coalesce(old,'null'::jsonb) is distinct from change->'before' then return jsonb_build_object('conflict',true,'message','Account values changed. Your device action is saved for review.','snapshot',public.kelime_snapshot()); end if;
  if k like 'deleted/%' and change->'after'<>'true'::jsonb then raise exception 'Deletion markers cannot be removed'; end if;
  if k like 'word/%' and exists(select 1 from public.account_records where user_id=owner_id and key='deleted/'||split_part(k,'/',2) and value='true'::jsonb) then raise exception 'Deleted words cannot be restored'; end if;
 end loop;
 rev:=rev+1;
 -- Words first so all subsequent references can be checked in this transaction.
 for change in select * from jsonb_array_elements(p_operation->'changes') c order by case when c->>'key' like 'word/%' then 0 else 1 end loop
  k:=change->>'key';v:=change->'after';ref:=split_part(k,'/',2);
  if k like 'word/%' and v<>'null'::jsonb then
   if v->>'id' is distinct from ref or jsonb_typeof(v->'turkishMeanings')<>'array' or jsonb_array_length(v->'turkishMeanings')=0 or exists(select 1 from jsonb_array_elements(v->'turkishMeanings') m where jsonb_typeof(m)<>'string' or btrim(m #>> '{}')='') then raise exception 'Invalid word'; end if;
   if ref like 'u:%' then
    insert into public.user_vocabulary(id,user_id,english,english_alternatives,turkish_meanings,part_of_speech,example_sentence,tags,created_at,updated_at,revision)
    values(substring(ref from 3)::uuid,owner_id,v->>'english',array(select jsonb_array_elements_text(coalesce(v->'englishAlternatives','[]'))),array(select jsonb_array_elements_text(v->'turkishMeanings')),v->>'partOfSpeech',v->>'example',array(select jsonb_array_elements_text(v->'tags')),public.kelime_time(v->'createdAt'),now(),rev)
    on conflict(user_id,id) do update set english=excluded.english,english_alternatives=excluded.english_alternatives,turkish_meanings=excluded.turkish_meanings,part_of_speech=excluded.part_of_speech,example_sentence=excluded.example_sentence,tags=excluded.tags,updated_at=now(),revision=rev;
   else
    perform public.kelime_reference(owner_id,ref);
    insert into public.builtin_overrides(user_id,vocabulary_id,content,revision) values(owner_id,substring(ref from 3),v,rev) on conflict(user_id,vocabulary_id) do update set content=v,revision=rev,updated_at=now();
   end if;
  end if;
  if k like 'word/b:%' and v='null'::jsonb then update public.builtin_overrides set content=null,revision=rev,updated_at=now() where user_id=owner_id and vocabulary_id=substring(ref from 3); end if;
  if k like 'session/%' and v<>'null'::jsonb then
   session_value:=case when k='session/review' then v->'practice' else v end;
   previous_session:=case when k='session/review' then change->'before'->'practice' else change->'before' end;
   s_id:=(session_value->>'syncId')::uuid;
   total:=jsonb_array_length(session_value->'questions');
   if s_id is null or total<1 or session_value->>'phase' not in ('answering','feedback','completed') or jsonb_array_length(session_value->'results')<>(session_value->>'index')::integer or (session_value->>'index')::integer not between 0 and total or ((session_value->>'phase'='completed')<>((session_value->>'index')::integer=total)) then raise exception 'Invalid practice state'; end if;
   if previous_session is not null and previous_session<>'null'::jsonb and previous_session->>'phase'<>'completed' and previous_session->>'syncId' is distinct from session_value->>'syncId' and p_operation->>'kind'<>'migration' then raise exception 'Finish the existing session first'; end if;
   if (select count(*)<>count(distinct x->>'wordId') from jsonb_array_elements(session_value->'questions') x) then raise exception 'Repeated question'; end if;
   for q in select * from jsonb_array_elements(session_value->'questions') loop
    perform public.kelime_reference(owner_id,q->>'wordId',session_value->>'phase'='completed');
    if q->>'direction' not in ('englishToTurkish','turkishToEnglish') or jsonb_typeof(q->'snapshot'->'acceptedAnswers')<>'array' or jsonb_array_length(q->'snapshot'->'acceptedAnswers')=0 then raise exception 'Invalid question'; end if;
   end loop;
   select count(*) filter(where (a->>'known')::boolean),count(*) filter(where (a->>'correct')::boolean) into known,correct from jsonb_array_elements(session_value->'results') a;
   insert into public.test_sessions(id,user_id,session_type,test_direction,started_at,completed_at,total_questions,known_count,missed_count,accuracy,state,revision)
   values(s_id,owner_id,split_part(k,'/',2),session_value->>'mode',public.kelime_time(session_value->'startedAt'),public.kelime_time(session_value->'completedAt'),total,known,(session_value->>'index')::integer-known,case when (session_value->>'index')::integer=0 then 0 else round(100.0*correct/(session_value->>'index')::integer)::integer end,session_value,rev)
   on conflict(user_id,id) do update set completed_at=excluded.completed_at,known_count=excluded.known_count,missed_count=excluded.missed_count,accuracy=excluded.accuracy,state=excluded.state,updated_at=now(),revision=rev;
   i:=0;
   for answer in select * from jsonb_array_elements(session_value->'results') loop
    q:=session_value->'questions'->i;
    if answer->>'wordId' is distinct from q->>'wordId' or answer->>'direction' is distinct from q->>'direction' then raise exception 'Answer alignment mismatch'; end if;
    ref:=answer->>'wordId';
    insert into public.test_answers(user_id,session_id,vocabulary_id,vocabulary_source,direction,typed_answer,was_correct,self_assessment_known,answered_at,activity_date,question_index,operation_id,snapshot)
    values(owner_id,s_id,substring(ref from 3),case when ref like 'b:%' then 'builtin' else 'user' end,answer->>'direction',answer->>'answer',(answer->>'correct')::boolean,(answer->>'known')::boolean,public.kelime_time(answer->'answeredAt'),(answer->>'activityDate')::date,i,op_id,answer->'snapshot')
    on conflict(user_id,session_id,question_index) do nothing;
    if exists(select 1 from public.test_answers where user_id=owner_id and session_id=s_id and question_index=i and (typed_answer is distinct from answer->>'answer' or was_correct is distinct from (answer->>'correct')::boolean or self_assessment_known is distinct from (answer->>'known')::boolean)) then raise exception 'A different answer was already recorded'; end if;
    i:=i+1;
   end loop;
  end if;
  if k='setting/goal' and (v #>> '{}')::integer not in (5,10,15,20,25,30) then raise exception 'Invalid daily goal'; end if;
  if k='setting/mode' and (v #>> '{}') not in ('englishToTurkish','turkishToEnglish','mixed') then raise exception 'Invalid mode'; end if;
  insert into public.account_records(user_id,key,value,revision) values(owner_id,k,v,rev) on conflict(user_id,key) do update set value=v,revision=rev,updated_at=now();
 end loop;
 -- Project progress after ALL cells, so Favorite and assessment order cannot disagree.
 for ref in select distinct split_part(c->>'key','/',2) from jsonb_array_elements(p_operation->'changes') c where c->>'key' like 'progress/%' or c->>'key' like 'favorite/%' loop
  word_id:=substring(ref from 3);source:=case when ref like 'b:%' then 'builtin' else 'user' end;
  if exists(select 1 from public.account_records where user_id=owner_id and key='deleted/'||ref and value='true'::jsonb) then continue; end if;
  perform public.kelime_reference(owner_id,ref);
  select value into h from public.account_records where user_id=owner_id and key='progress/'||ref;
  select coalesce(value='true'::jsonb,false) into favorite from public.account_records where user_id=owner_id and key='favorite/'||ref;
  favorite:=coalesce(favorite,false);
  if h is null or h='null'::jsonb then
   insert into public.learning_progress(user_id,vocabulary_id,vocabulary_source,favorite,revision) values(owner_id,word_id,source,favorite,rev) on conflict(user_id,vocabulary_source,vocabulary_id) do update set favorite=excluded.favorite,learned=false,needs_review=false,times_tested=0,times_known=0,times_missed=0,consecutive_known=0,last_tested_at=null,last_known_at=null,next_review_at=null,english_to_turkish_stats='{}',turkish_to_english_stats='{}',updated_at=now(),revision=rev;
  else
   perform public.kelime_stats(h);perform public.kelime_stats(h->'englishToTurkish');perform public.kelime_stats(h->'turkishToEnglish');
   if (h->>'timesTested')::integer<>(h->'englishToTurkish'->>'timesTested')::integer+(h->'turkishToEnglish'->>'timesTested')::integer then raise exception 'Directional counters do not match'; end if;
   deadline:=least(public.kelime_deadline(h->'englishToTurkish'),public.kelime_deadline(h->'turkishToEnglish'));
   if (h->>'legacyReviewPending')::boolean and (h->>'learned')::boolean then deadline:=now(); end if;
   insert into public.learning_progress(user_id,vocabulary_id,vocabulary_source,favorite,learned,needs_review,times_tested,times_known,times_missed,consecutive_known,last_tested_at,last_known_at,next_review_at,english_to_turkish_stats,turkish_to_english_stats,revision)
   values(owner_id,word_id,source,favorite,(h->>'learned')::boolean,coalesce(deadline<=now(),false),(h->>'timesTested')::integer,(h->>'timesKnown')::integer,(h->>'timesMissed')::integer,(h->>'consecutiveKnown')::integer,public.kelime_time(h->'lastTestedAt'),public.kelime_time(h->'lastKnownAt'),deadline,h->'englishToTurkish',h->'turkishToEnglish',rev)
   on conflict(user_id,vocabulary_source,vocabulary_id) do update set favorite=excluded.favorite,learned=excluded.learned,needs_review=excluded.needs_review,times_tested=excluded.times_tested,times_known=excluded.times_known,times_missed=excluded.times_missed,consecutive_known=excluded.consecutive_known,last_tested_at=excluded.last_tested_at,last_known_at=excluded.last_known_at,next_review_at=excluded.next_review_at,english_to_turkish_stats=excluded.english_to_turkish_stats,turkish_to_english_stats=excluded.turkish_to_english_stats,updated_at=now(),revision=rev;
  end if;
 end loop;
 for change in select * from jsonb_array_elements(p_operation->'changes') c where c->>'key' like 'deleted/%' loop
  ref:=split_part(change->>'key','/',2);
  if ref not like 'u:%' then raise exception 'Built-in words cannot be deleted'; end if;
  perform public.kelime_reference(owner_id,ref,true);
  if exists(select 1 from public.account_records r cross join lateral jsonb_array_elements(case when r.key='session/review' then r.value->'practice'->'questions' else r.value->'questions' end) q where r.user_id=owner_id and r.key in ('session/daily','session/review') and (case when r.key='session/review' then r.value->'practice'->>'phase' else r.value->>'phase' end)<>'completed' and q->>'wordId'=ref) then raise exception 'Finish the practice session before deleting this word'; end if;
  update public.user_vocabulary set deleted_at=now(),updated_at=now(),revision=rev where user_id=owner_id and id=substring(ref from 3)::uuid;
  delete from public.learning_progress where user_id=owner_id and vocabulary_source='user' and vocabulary_id=substring(ref from 3);
  delete from public.account_records where user_id=owner_id and key in ('word/'||ref,'progress/'||ref,'favorite/'||ref);
 end loop;
 for change in select * from jsonb_array_elements(p_operation->'changes') c where c->>'key' like 'suppressed/%' loop
  ref:=split_part(change->>'key','/',2);perform public.kelime_reference(owner_id,ref);
  insert into public.builtin_overrides(user_id,vocabulary_id,suppressed,revision) values(owner_id,substring(ref from 3),change->'after'='true'::jsonb,rev) on conflict(user_id,vocabulary_id) do update set suppressed=excluded.suppressed,revision=rev,updated_at=now();
 end loop;
 update public.profiles set revision=rev where id=owner_id;
 insert into public.operation_receipts(user_id,id) values(owner_id,op_id);
 if migration_id is not null then insert into public.migration_receipts(user_id,id,operation_id) values(owner_id,migration_id,op_id); end if;
 return jsonb_build_object('conflict',false,'snapshot',public.kelime_snapshot());
end $$;
revoke all on function public.kelime_time(jsonb),public.kelime_reference(uuid,text,boolean),public.kelime_stats(jsonb),public.kelime_deadline(jsonb),public.kelime_snapshot(),public.kelime_apply(jsonb) from public,anon,authenticated;
grant execute on function public.kelime_snapshot(),public.kelime_apply(jsonb) to authenticated;
