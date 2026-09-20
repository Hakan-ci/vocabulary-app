-- Apply after 006. Provider operations contain no conversation content.
create or replace function public.kelime_ai_evidence(owner_id uuid,v jsonb) returns void language plpgsql set search_path='' as $$
declare w jsonb; ref text;
begin
 if jsonb_typeof(v)<>'object' or v-array['id','sourceQuizId','completedAt','mode','evaluator','epoch','words']<>'{}'::jsonb
  or not (v ?& array['id','sourceQuizId','completedAt','mode','evaluator','epoch','words'])
  or exists(select 1 from unnest(array['id','mode','evaluator']) field where jsonb_typeof(v->field)<>'string')
  or v->>'evaluator' not in ('mock','openai','deterministic') or v->>'mode' not in ('voiceAnswer','useTheWord','conversation')
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

create table public.ai_practice_lock (id boolean primary key default true check(id));
insert into public.ai_practice_lock values(true);
create table public.ai_practice_sessions (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default clock_timestamp()
);
create table public.ai_practice_attempts (
 id uuid primary key, owner_id uuid not null references auth.users(id) on delete cascade,
 session_id uuid not null references public.ai_practice_sessions(id) on delete cascade,
 request_id uuid not null, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 model text not null check(model='gpt-5.6-terra'),
 created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null, cost_micros bigint not null check(cost_micros>=0),
 status text not null check(status in ('reserved','success','timeout','provider_unavailable','invalid_output','expired')),
 latency_ms bigint, input_tokens bigint, output_tokens bigint
);
create index ai_practice_owner_time on public.ai_practice_attempts(owner_id,created_at);
create index ai_practice_time on public.ai_practice_attempts(created_at);
alter table public.ai_practice_lock enable row level security;
alter table public.ai_practice_sessions enable row level security;
alter table public.ai_practice_attempts enable row level security;
revoke all on public.ai_practice_lock,public.ai_practice_sessions,public.ai_practice_attempts from public,anon,authenticated;

create function public.kelime_ai_cleanup() returns void language plpgsql security definer set search_path='' as $$
begin
 delete from public.ai_practice_sessions where created_at<clock_timestamp()-interval '7 days';
 update public.ai_practice_attempts set status='expired' where status='reserved' and expires_at<clock_timestamp();
end $$;
create function public.kelime_ai_reserve(p_owner uuid,p_session uuid,p_request uuid,p_attempt uuid,p_fingerprint text,p_model text,p_cost bigint)
returns text language plpgsql security definer set search_path='' as $$
declare now_at timestamptz:=clock_timestamp(); day_at timestamptz; prior public.ai_practice_attempts; session_row public.ai_practice_sessions;
begin
 if p_owner is null or p_session is null or p_request is null or p_attempt is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_model is distinct from 'gpt-5.6-terra' or p_cost is null or p_cost not between 42000 and 1000000 then raise exception 'Invalid reservation' using errcode='23514';end if;
 -- Global lock makes daily budgets and per-user reservations atomic across edge instances.
 perform 1 from public.ai_practice_lock where id=true for update;
 now_at:=clock_timestamp();
 perform public.kelime_ai_cleanup();
 day_at:=date_trunc('day',now_at at time zone 'UTC') at time zone 'UTC';
 select * into prior from public.ai_practice_attempts where id=p_attempt;
 if found then return 'duplicate';end if;
 select * into session_row from public.ai_practice_sessions where id=p_session;
 if found and (session_row.owner_id<>p_owner or session_row.created_at<now_at-interval '60 minutes') then return 'session_limit';end if;
 if exists(select 1 from public.ai_practice_attempts where request_id=p_request and (owner_id<>p_owner or session_id<>p_session or fingerprint<>p_fingerprint)) then return 'identity_mismatch';end if;
 if (select count(*) from public.ai_practice_attempts where request_id=p_request)>=2 then return 'attempt_limit';end if;
 if exists(select 1 from public.ai_practice_attempts where owner_id=p_owner and status='reserved' and expires_at>now_at) then return 'busy';end if;
 if (select count(*) from public.ai_practice_attempts where owner_id=p_owner and created_at>now_at-interval '1 minute')>=6
 or (select count(*) from public.ai_practice_attempts where owner_id=p_owner and created_at>=day_at)>=100
 or (select count(*) from public.ai_practice_attempts where session_id=p_session)>=24 then return 'rate_limit';end if;
 if (select coalesce(sum(cost_micros),0) from public.ai_practice_attempts where owner_id=p_owner and created_at>=day_at)+p_cost>1000000
 or (select coalesce(sum(cost_micros),0) from public.ai_practice_attempts where created_at>=day_at)+p_cost>10000000 then return 'budget';end if;
 insert into public.ai_practice_sessions(id,owner_id) values(p_session,p_owner) on conflict do nothing;
 insert into public.ai_practice_attempts(id,owner_id,session_id,request_id,fingerprint,model,expires_at,cost_micros,status)
 values(p_attempt,p_owner,p_session,p_request,p_fingerprint,p_model,now_at+interval '45 seconds',p_cost,'reserved');
 return 'reserved';
end $$;
create function public.kelime_ai_settle(p_owner uuid,p_attempt uuid,p_status text,p_latency bigint,p_input bigint default null,p_output bigint default null)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_status is null or p_status not in ('success','timeout','provider_unavailable','invalid_output') or p_latency is null or p_latency<0
 or (p_input is null)<>(p_output is null) or p_input not between 0 and 1000000 or p_output not between 0 and 3500 then raise exception 'Invalid settlement' using errcode='23514';end if;
 perform 1 from public.ai_practice_lock where id=true for update;
 update public.ai_practice_attempts set status=p_status,latency_ms=p_latency,input_tokens=p_input,output_tokens=p_output,
 cost_micros=case when p_input is null then cost_micros else ceil(p_input*2.5+p_output*12)::bigint end
 where id=p_attempt and owner_id=p_owner and status in ('reserved','expired');
end $$;
revoke all on function public.kelime_ai_cleanup(),public.kelime_ai_reserve(uuid,uuid,uuid,uuid,text,text,bigint),public.kelime_ai_settle(uuid,uuid,text,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.kelime_ai_reserve(uuid,uuid,uuid,uuid,text,text,bigint),public.kelime_ai_settle(uuid,uuid,text,bigint,bigint,bigint) to service_role;
-- Supabase supports pg_cron. PGlite lacks extensions; its tests invoke cleanup directly.
do $$ begin
 if exists(select 1 from pg_available_extensions where name='pg_cron') then
  create extension if not exists pg_cron;
  perform cron.schedule('kelime-ai-retention','0 * * * *','select public.kelime_ai_cleanup()');
 end if;
end $$;
