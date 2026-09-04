-- Run only against a disposable test project. Every fixture rolls back.
begin;
insert into auth.users(id) values('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002');
set local role anon;
do $$ begin
 begin perform public.kelime_snapshot(); raise exception 'Anonymous RPC was allowed'; exception when insufficient_privilege then null; end;
 begin perform * from public.user_vocabulary; raise exception 'Anonymous table access was allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',true);
set local role authenticated;
select public.kelime_snapshot();
select public.kelime_apply('{"accountId":"10000000-0000-4000-8000-000000000001","id":"20000000-0000-4000-8000-000000000001","kind":"vocabulary","changes":[{"key":"word/u:30000000-0000-4000-8000-000000000001","before":null,"after":{"id":"u:30000000-0000-4000-8000-000000000001","english":"fixture","turkishMeanings":["örnek"],"tags":[],"createdAt":null}}]}'::jsonb);
-- A lost response and retry cannot repeat a transaction or increment revision.
do $$ declare r bigint; begin
 select revision into r from public.profiles;
 perform public.kelime_apply('{"accountId":"10000000-0000-4000-8000-000000000001","id":"20000000-0000-4000-8000-000000000001","kind":"vocabulary","changes":[]}'::jsonb);
 if (select revision from public.profiles)<>r then raise exception 'Retry incremented revision'; end if;
 begin insert into public.learning_progress(user_id,vocabulary_id,vocabulary_source) values(auth.uid(),'0','builtin'); raise exception 'Direct write bypassed transaction'; exception when insufficient_privilege then null; end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',true);
set local role authenticated;
select public.kelime_snapshot();
do $$ declare t text; n integer; begin
 foreach t in array array['user_vocabulary','learning_progress','test_sessions','test_answers','account_records','builtin_overrides','operation_receipts','migration_receipts'] loop
  execute format('select count(*) from public.%I where user_id<>auth.uid()',t) into n;
  if n<>0 then raise exception 'Cross-account rows exposed: %',t; end if;
 end loop;
 if exists(select 1 from public.profiles where id<>auth.uid()) then raise exception 'Other profile exposed'; end if;
 begin
  perform public.kelime_apply('{"accountId":"10000000-0000-4000-8000-000000000002","id":"20000000-0000-4000-8000-000000000002","kind":"favorite","changes":[{"key":"favorite/u:30000000-0000-4000-8000-000000000001","before":null,"after":true}]}'::jsonb);
  raise exception 'Expected ownership rejection';
 exception when raise_exception then if SQLERRM='Expected ownership rejection' then raise; end if; end;
 if exists(select 1 from public.account_records) or exists(select 1 from public.operation_receipts) then raise exception 'Failed operation left partial changes'; end if;
 -- Word is inserted first; invalid progress later must roll it back atomically.
 begin
  perform public.kelime_apply('{"accountId":"10000000-0000-4000-8000-000000000002","id":"20000000-0000-4000-8000-000000000003","kind":"migration","migrationId":"40000000-0000-4000-8000-000000000001","expectedRevision":0,"changes":[{"key":"word/u:30000000-0000-4000-8000-000000000002","before":null,"after":{"id":"u:30000000-0000-4000-8000-000000000002","english":"rollback","turkishMeanings":["geri al"],"tags":[]}},{"key":"progress/b:0","before":null,"after":{"timesTested":-1}}]}'::jsonb);
  raise exception 'Expected rollback';
 exception when raise_exception then if SQLERRM='Expected rollback' then raise; end if; end;
 if exists(select 1 from public.user_vocabulary) or exists(select 1 from public.account_records) or exists(select 1 from public.migration_receipts) then raise exception 'Transaction did not roll back'; end if;
 begin
  perform public.kelime_apply('{"accountId":"10000000-0000-4000-8000-000000000001","id":"20000000-0000-4000-8000-000000000004","kind":"preferences","changes":[]}'::jsonb);
  raise exception 'Wrong account operation accepted';
 exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
