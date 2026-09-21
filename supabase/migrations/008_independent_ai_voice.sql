-- Independent evidence and supervised voice pilot; apply after 007.
-- Apply after 006. Provider operations contain no conversation content.
create or replace function public.kelime_ai_evidence(owner_id uuid,v jsonb) returns void language plpgsql set search_path='' as $$
declare w jsonb; ref text;
begin
 if jsonb_typeof(v)<>'object' or v-array['id','sourceQuizId','completedAt','mode','evaluator','epoch','words','schemaVersion','provenance','inputModality']<>'{}'::jsonb
  or not (v ?& array['id','sourceQuizId','completedAt','mode','evaluator','epoch','words'])
  or exists(select 1 from unnest(array['id','mode','evaluator']) field where jsonb_typeof(v->field)<>'string')
  or v->>'evaluator' not in ('mock','openai','deterministic') or v->>'mode' not in ('voiceAnswer','useTheWord','conversation')
  or jsonb_typeof(v->'completedAt')<>'number' or (v->>'completedAt')::numeric not between 0 and 8640000000000000
  or jsonb_typeof(v->'epoch')<>'number' or (v->>'epoch')::numeric not between 0 and 9007199254740991 or (v->>'epoch')::numeric<>trunc((v->>'epoch')::numeric)
  or jsonb_typeof(v->'words')<>'array' or jsonb_array_length(v->'words') not between 1 and 8 then raise exception 'Invalid compact evidence' using errcode='23514';end if;
 if v ? 'schemaVersion' then
  if v->'schemaVersion'<>'2'::jsonb or not(v ?& array['provenance','inputModality']) or v->>'provenance' not in ('automatic','manual','quizFollowup') or v->>'inputModality' not in ('text','voice')
   or jsonb_typeof(v->'provenance')<>'string' or jsonb_typeof(v->'inputModality')<>'string'
   or v->>'provenance'<>'quizFollowup' and v->'sourceQuizId'<>'null'::jsonb
   or v->>'inputModality'='voice' and (v->>'mode'<>'conversation' or v->>'evaluator'<>'openai') then raise exception 'Invalid evidence provenance' using errcode='23514';end if;
 elsif v ?| array['provenance','inputModality'] then raise exception 'Missing evidence version' using errcode='23514';end if;
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

create table public.ai_voice_health(id boolean primary key default true check(id), checked_at timestamptz, blocked boolean not null default false);
insert into public.ai_voice_health values(true,null,false);
create table public.ai_voice_sessions(
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 practice_id uuid not null, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 model text not null default 'gpt-live-1' check(model='gpt-live-1'),
 provider_id text unique check(provider_id ~ '^[a-zA-Z0-9_-]{1,200}$'),
 created_at timestamptz not null default clock_timestamp(), deadline timestamptz not null default clock_timestamp()+interval '120 seconds',
 status text not null default 'creating' check(status in ('creating','active','closed','uncertain')),
 cost_micros bigint not null default 200000 check(cost_micros>=0), usage_seconds numeric check(usage_seconds>=0)
);
create index ai_voice_owner_time on public.ai_voice_sessions(owner_id,created_at);
alter table public.ai_voice_health enable row level security;
alter table public.ai_voice_sessions enable row level security;
revoke all on public.ai_voice_health,public.ai_voice_sessions from public,anon,authenticated;

create function public.kelime_voice_available() returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from public.ai_voice_health where not blocked and checked_at>clock_timestamp()-interval '90 seconds')
 and not exists(select 1 from public.ai_voice_sessions where status<>'closed' and (deadline<clock_timestamp() or status='uncertain'));
$$;
create function public.kelime_voice_reserve(p_owner uuid,p_attempt uuid,p_session uuid,p_fingerprint text) returns text language plpgsql security definer set search_path='' as $$
declare day_at timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
 if p_owner is null or p_attempt is null or p_session is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then raise exception 'Invalid voice reservation' using errcode='23514';end if;
 perform 1 from public.ai_practice_lock where id=true for update;
 if exists(select 1 from public.ai_voice_sessions where id=p_attempt) then return 'duplicate';end if;
 if not public.kelime_voice_available() then return 'unavailable';end if;
 if exists(select 1 from public.ai_voice_sessions where owner_id=p_owner and status<>'closed') or (select count(*) from public.ai_voice_sessions where status<>'closed')>=3 then return 'busy';end if;
 if (select count(*) from public.ai_voice_sessions where owner_id=p_owner and created_at>clock_timestamp()-interval '1 minute')>=3 or (select count(*) from public.ai_voice_sessions where owner_id=p_owner and created_at>=day_at)>=4 then return 'rate_limit';end if;
 if (select coalesce(sum(cost_micros),0) from public.ai_voice_sessions where owner_id=p_owner and created_at>=day_at)+(select coalesce(sum(cost_micros),0) from public.ai_practice_attempts where owner_id=p_owner and created_at>=day_at)+200000>1000000
 or (select coalesce(sum(cost_micros),0) from public.ai_voice_sessions where created_at>=day_at)+(select coalesce(sum(cost_micros),0) from public.ai_practice_attempts where created_at>=day_at)+200000>10000000 then return 'budget';end if;
 insert into public.ai_voice_sessions(id,owner_id,practice_id,fingerprint) values(p_attempt,p_owner,p_session,p_fingerprint);
 return 'reserved';
end $$;
-- Text reservations participate in the same combined budget without modifying 007.
alter function public.kelime_ai_reserve(uuid,uuid,uuid,uuid,text,text,bigint) rename to kelime_ai_reserve_007;
revoke all on function public.kelime_ai_reserve_007(uuid,uuid,uuid,uuid,text,text,bigint) from public,anon,authenticated,service_role;
create function public.kelime_ai_reserve(p_owner uuid,p_session uuid,p_request uuid,p_attempt uuid,p_fingerprint text,p_model text,p_cost bigint) returns text language plpgsql security definer set search_path='' as $$
declare day_at timestamptz:=date_trunc('day',clock_timestamp() at time zone 'UTC') at time zone 'UTC';
begin
 perform 1 from public.ai_practice_lock where id=true for update;
 if exists(select 1 from public.ai_practice_attempts where id=p_attempt) then return 'duplicate';end if;
 if (select coalesce(sum(cost_micros),0) from public.ai_voice_sessions where owner_id=p_owner and created_at>=day_at)+(select coalesce(sum(cost_micros),0) from public.ai_practice_attempts where owner_id=p_owner and created_at>=day_at)+p_cost>1000000
 or (select coalesce(sum(cost_micros),0) from public.ai_voice_sessions where created_at>=day_at)+(select coalesce(sum(cost_micros),0) from public.ai_practice_attempts where created_at>=day_at)+p_cost>10000000 then return 'budget';end if;
 return public.kelime_ai_reserve_007(p_owner,p_session,p_request,p_attempt,p_fingerprint,p_model,p_cost);
end $$;
create function public.kelime_voice_state(p_owner uuid,p_attempt uuid,p_action text,p_provider text default null,p_seconds numeric default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.ai_voice_sessions;
begin
 perform 1 from public.ai_practice_lock where id=true for update;
 select * into r from public.ai_voice_sessions where id=p_attempt and owner_id=p_owner;
 if not found then return null;end if;
 if p_action='attach' then
  if r.status<>'creating' or p_provider is null or p_provider !~ '^[a-zA-Z0-9_-]{1,200}$' then raise exception 'Invalid voice attachment';end if;
  update public.ai_voice_sessions set provider_id=p_provider,status='active' where id=p_attempt;
 elsif p_action='closed' then
  if p_seconds is not null and (p_seconds<0 or p_seconds>86400 or p_seconds='NaN'::numeric) then raise exception 'Invalid voice usage';end if;
  update public.ai_voice_sessions set status='closed',usage_seconds=coalesce(usage_seconds,p_seconds),cost_micros=case when p_seconds is null or usage_seconds is not null then cost_micros else greatest(12500,ceil(p_seconds*1000000/1200)::bigint) end where id=p_attempt;
 elsif p_action='uncertain' then
  update public.ai_voice_sessions set status='uncertain' where id=p_attempt and status<>'closed';
 elsif p_action<>'get' then raise exception 'Invalid voice action';end if;
 select * into r from public.ai_voice_sessions where id=p_attempt;
 return jsonb_build_object('providerId',r.provider_id,'closed',r.status='closed','expiresAt',floor(extract(epoch from r.deadline)*1000));
end $$;
create function public.kelime_voice_sweep() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.ai_practice_lock where id=true for update;
 update public.ai_voice_health set blocked=true where exists(select 1 from public.ai_voice_sessions where status<>'closed' and created_at<clock_timestamp()-interval '7 days');
 delete from public.ai_voice_sessions where created_at<clock_timestamp()-interval '7 days';
 update public.ai_voice_sessions set status='uncertain' where status='creating' and created_at<clock_timestamp()-interval '30 seconds';
 return (select coalesce(jsonb_agg(jsonb_build_object('owner',owner_id,'attempt',id,'providerId',provider_id)),'[]'::jsonb) from public.ai_voice_sessions where status<>'closed' and (deadline<clock_timestamp() or status='uncertain'));
end $$;
create function public.kelime_voice_heartbeat() returns void language sql security definer set search_path='' as $$
 update public.ai_voice_health set checked_at=clock_timestamp() where id=true;
$$;
revoke all on function public.kelime_voice_available(),public.kelime_voice_reserve(uuid,uuid,uuid,text),public.kelime_voice_state(uuid,uuid,text,text,numeric),public.kelime_voice_sweep(),public.kelime_voice_heartbeat(),public.kelime_ai_reserve(uuid,uuid,uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.kelime_voice_available(),public.kelime_voice_reserve(uuid,uuid,uuid,text),public.kelime_voice_state(uuid,uuid,text,text,numeric),public.kelime_voice_sweep(),public.kelime_voice_heartbeat(),public.kelime_ai_reserve(uuid,uuid,uuid,uuid,text,text,bigint) to service_role;
-- An operator configures the authenticated minute scheduler after server secrets exist.
-- Availability fails closed until that scheduler successfully updates the heartbeat.
