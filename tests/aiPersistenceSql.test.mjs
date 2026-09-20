import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {database} from './dbHarness.mjs'
import {decodeData,encodeData,emptyIdentities} from '../src/data/codec.ts'
import {diffCells} from '../src/data/syncService.ts'
import {createReviewSession} from '../src/reviewModel.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {assessReviewState,assessLearningState} from '../src/learningState.ts'
import {words} from '../src/vocabulary.ts'
const owner='10000000-0000-4000-8000-000000000001',other='10000000-0000-4000-8000-000000000002',now=1700000000000
const evidence=(wordId='b:0',direction='englishToTurkish')=>({id:crypto.randomUUID(),sourceQuizId:null,completedAt:now,mode:'voiceAnswer',evaluator:'mock',epoch:0,words:[{wordId,direction,outcome:'needsPractice',retrieval:'missing',semantic:'unassessed',grammar:'unassessed',suggested:true}]})
const request=e=>({id:crypto.randomUUID(),wordId:e.words[0].wordId,direction:e.words[0].direction,requestedAt:now,source:'aiPractice',sourceSessionId:e.id,epoch:0,status:'active'})
const operation=(kind,changes,extra={})=>({id:crypto.randomUUID(),accountId:owner,protocol:5,learningEpoch:0,at:now,kind,changes,...extra})
const put=(prefix,value)=>({key:prefix+'/'+value.id,before:null,after:value})
async function fixture(db){
 await db.exec(`insert into auth.users(id) values('${owner}'),('${other}');set "request.jwt.claim.sub"='${owner}';set role authenticated;`)
 const call=async op=>(await db.query('select public.kelime_apply_v5($1) r',[JSON.stringify(op)])).rows[0].r
 const snapshot=async()=>(await db.query('select public.kelime_snapshot_v5() r')).rows[0].r
 const add=async(e=evidence())=>{assert.equal((await call(operation('ai-complete',[put('ai-evidence',e)]))).conflict,false);const r=request(e);const op=operation('review-request',[put('review-request',r)]);assert.equal((await call(op)).conflict,false);return {e,r,op}}
 return {call,snapshot,add}
}
test('protocol 5 evidence/request batches are private, bounded, atomic and immutable; old writers are gated after adoption',async()=>{
 const db=await database()
 try{
 const {call,snapshot,add}=await fixture(db)
 // An unupgraded account retains the existing endpoint and its validation behavior.
 const legacy=operation('favorite',[{key:'favorite/b:2',before:null,after:true}],{protocol:4});delete legacy.learningEpoch
 await db.query('select public.kelime_apply_v4($1)',[JSON.stringify(legacy)])
 const mastery=(await db.query('select * from public.learning_progress')).rows
 const {e,r,op}=await add(),first=await snapshot()
 const retry=await call(op);assert.equal(retry.snapshot.revision,first.revision)
 assert.equal((await call({...op,id:crypto.randomUUID()})).conflict,false)
 assert.deepEqual((await db.query('select * from public.learning_progress')).rows,mastery)
 assert.equal((await db.query('select count(*)::int n from public.assessment_events')).rows[0].n,0)
 for(const malformed of [{...e,turns:['secret']},{...e,words:[{...e.words[0],grammar:null}]},{...e,words:[{...e.words[0],outcome:'correct'}]},{...e,epoch:.5}])await assert.rejects(()=>call(operation('ai-complete',[put('ai-evidence',malformed)])))
 await assert.rejects(()=>call(operation('ai-complete',[put('ai-evidence',e)],{protocol:4})),/protocol 5/)
 const invalidSource={...evidence(),sourceQuizId:crypto.randomUUID()};await assert.rejects(()=>call(operation('ai-complete',[put('ai-evidence',invalidSource)])),/completed Daily Test/)
 const changed={...e,mode:'conversation'};assert.equal((await call(operation('ai-complete',[put('ai-evidence',changed)]))).conflict,true)
 const dup={...r,id:crypto.randomUUID()};assert.equal((await call(operation('review-request',[put('review-request',dup)]))).conflict,true)
 const unknown={...r,id:crypto.randomUUID(),sourceSessionId:crypto.randomUUID()};await assert.rejects(()=>call(operation('review-request',[put('review-request',unknown)])),/suggested evidence/)
 const good=evidence('b:1'),bad={...evidence('b:2'),turns:['private']},revision=(await snapshot()).revision
 await assert.rejects(()=>call(operation('ai-complete',[put('ai-evidence',good),put('ai-evidence',bad)])))
 assert.equal((await snapshot()).cells['ai-evidence/'+good.id],undefined);assert.equal((await snapshot()).revision,revision)
 await assert.rejects(()=>db.query('select public.kelime_apply_v4($1)',[JSON.stringify({...legacy,id:crypto.randomUUID()})]),/Update Kelime/)
 // The new client's compatibility path accepts the original legacy wire payload unchanged.
 assert.equal((await call({...legacy,id:crypto.randomUUID(),changes:[{key:'favorite/b:3',before:null,after:true}]})).conflict,false)
 await assert.rejects(()=>db.query("insert into public.account_records(user_id,key,value) values($1,'ai-evidence/forged','{}')",[owner]),/permission denied/)
 await db.exec(`set "request.jwt.claim.sub"='${other}'`);assert.equal((await snapshot()).cells['ai-evidence/'+e.id],undefined)
 assert.equal((await db.query('select count(*)::int n from public.account_records')).rows[0].n,0)
 await assert.rejects(()=>call(op),/Authentication required/)
 await db.exec('reset role;set role anon');await assert.rejects(()=>snapshot(),/permission denied/)
 }finally{await db.close()}
})
test('only accepted Review assessments resolve observed IDs, unseen and opposite-direction requests survive and retries cannot resurrect',async()=>{
 const db=await database()
 try{
 const {call,snapshot,add}=await fixture(db),a=await add()
 const baseline=(await snapshot()).cells,map0=emptyIdentities();await call(operation('preferences',diffCells(baseline,encodeData(decodeData(baseline,map0,now),map0))))
 const initial=(await snapshot()).cells
 const client=()=>{const map=emptyIdentities();return {map,data:decodeData(initial,map,now),base:initial}}
 const devices=[client(),client()]
 async function save(c,kind){const practice=c.data.learning.reviewSession.practice;c.data.learning.sessions={...c.data.learning.sessions,[practice.syncId]:{source:'review',practice}};const after=encodeData(c.data,c.map),op=operation(kind,diffCells(c.base,after));const result=await call(op);assert.equal(result.conflict,false,result.message);c.base=after;return op}
 for(const c of devices){c.data.learning.reviewSession=createReviewSession(words,c.data.learning.history,now,()=>0,c.data.learning.reviewRequests);await save(c,'start');c.data.learning.reviewSession.practice=submitAnswer({...c.data.learning.reviewSession.practice,draft:'wrong'});await save(c,'submit')}
 const late=await add(),opposite=await add(evidence('b:0','turkishToEnglish'))
 const eventIds=[]
 for(const [i,c] of devices.entries()){c.data.learning=assessReviewState(c.data.learning,i===0,now+i,words);eventIds.push(c.data.learning.reviewSession.practice.results[0].eventId);const op=await save(c,'assess');await call(op)}
 let cells=(await snapshot()).cells
 assert.equal(cells['review-request/'+a.r.id].status,'resolved');assert.equal(cells['review-request/'+a.r.id].resolvedBy,eventIds.sort()[0])
 assert.equal(cells['review-request/'+late.r.id].status,'active');assert.equal(cells['review-request/'+opposite.r.id].status,'active')
 assert.equal(cells['progress/b:0'].timesTested,2);assert.equal(cells['progress/b:0'].timesMissed,1)
 await call({...a.op,id:crypto.randomUUID()});assert.equal((await snapshot()).cells['review-request/'+a.r.id].status,'resolved')
 // Forged IDs fail inside the same assessment transaction and roll back history/activity.
 const map=emptyIdentities(),data=decodeData(cells,map,now),c={data,map,base:cells};data.learning.reviewSession=createReviewSession(words,data.learning.history,now,()=>0,data.learning.reviewRequests);await save(c,'start');data.learning.reviewSession.practice=submitAnswer({...data.learning.reviewSession.practice,draft:'wrong'});await save(c,'submit')
 const before=await snapshot();data.learning=assessReviewState(data.learning,true,now+2,words);data.learning.reviewSession.practice.results[0].resolvedReviewRequestIds=[crypto.randomUUID()]
 await assert.rejects(()=>save(c,'assess'),/does not match/);assert.deepEqual(await snapshot(),before)
 }finally{await db.close()}
})
test('server deletion invalidates unseen requests, restore cannot revive, reset advances epoch and rejects stale writes',async()=>{
 const db=await database()
 try{
 const {call,snapshot,add}=await fixture(db),a=await add()
 const hidden=await call(operation('bulk-delete',[{key:'hidden/b:0',before:null,after:true}]))
 assert.equal(hidden.conflict,false);assert.equal(hidden.snapshot.cells['review-request/'+a.r.id].status,'cancelled')
 const restore=await call(operation('restore',[{key:'hidden/b:0',before:true,after:null}]))
 assert.equal(restore.conflict,false);assert.equal(restore.snapshot.cells['review-request/'+a.r.id].status,'cancelled')
 await call({...a.op,id:crypto.randomUUID()});assert.equal((await snapshot()).cells['review-request/'+a.r.id].status,'cancelled')
 const reset=await call(operation('reset-progress',[]));assert.equal(reset.conflict,false);assert.equal(reset.snapshot.cells['learning/epoch'],1)
 assert.equal(reset.snapshot.cells['ai-evidence/'+a.e.id],undefined);assert.equal(reset.snapshot.cells['review-request/'+a.r.id],undefined)
 const stale=await call(operation('ai-complete',[put('ai-evidence',evidence())]));assert.equal(stale.conflict,true);assert.match(stale.message,/reset epoch/)
 const fresh={...evidence(),epoch:1};assert.equal((await call(operation('ai-complete',[put('ai-evidence',fresh)],{learningEpoch:1}))).conflict,false)
 const cleared=await call(operation('clear-all',[],{learningEpoch:1}));assert.equal(cleared.snapshot.cells['learning/epoch'],2);assert.equal(cleared.snapshot.cells['ai-evidence/'+fresh.id],undefined)
 }finally{await db.close()}
})
test('protocol 5 keeps draft compaction and reconciliation receipts intact',async()=>{
 const db=await database()
 try{
 const {call,snapshot}=await fixture(db),map=emptyIdentities(),data=decodeData({},map,now)
 data.learning.session=createSession(data.learning.history,now,()=>0);const id=data.learning.session.syncId
 let base={},drafts=[]
 for(const draft of [null,'a','ab']){if(draft!==null)data.learning.session={...data.learning.session,draft};data.learning.sessions={[id]:{source:'daily',practice:data.learning.session}};const next=encodeData(data,map),op=operation(draft===null?'start':'draft',diffCells(base,next));if(draft===null)await call(op);else drafts.push(op);base=next}
 const result=(await db.query('select public.kelime_compact_drafts_v5($1,$2) r',[JSON.stringify(drafts),crypto.randomUUID()])).rows[0].r
 assert.deepEqual(new Set(result.accepted),new Set(drafts.map(d=>d.id)));assert.equal(result.snapshot.cells['learning/epoch'],0)
 const before=await snapshot();for(const draft of drafts)assert.deepEqual((await call(draft)).snapshot,before)
 }finally{await db.close()}
})
test('migration 006 upgrades a populated 005 database without rewriting previous receipts',async()=>{
 const db=await database(5)
 try{
 await db.exec(`insert into auth.users(id) values('${owner}');set "request.jwt.claim.sub"='${owner}'`)
 const legacy=operation('favorite',[{key:'favorite/b:1',before:null,after:true}],{protocol:4})
 const prior=(await db.query('select public.kelime_apply_v4($1) r',[JSON.stringify(legacy)])).rows[0].r
 await db.exec(await readFile(new URL('../supabase/migrations/006_ai_practice_review.sql',import.meta.url),'utf8'))
 const after=(await db.query('select public.kelime_apply_v5($1) r',[JSON.stringify(legacy)])).rows[0].r
 assert.equal(after.snapshot.revision,prior.snapshot.revision);assert.equal(after.snapshot.cells['favorite/b:1'],true);assert.equal(after.snapshot.cells['learning/epoch'],0)
 }finally{await db.close()}
})
test('guest import keeps evidence and resolved provenance atomic, uses dataset receipts and cannot reimport after reset',async()=>{
 const db=await database()
 try{
 const {call,snapshot}=await fixture(db),map=emptyIdentities(),data=decodeData({},map,now),e=evidence(),r=request(e)
 data.learning.session=createSession(data.learning.history,now,()=>0)
 while(data.learning.session.phase!=='completed'){data.learning.session=submitAnswer({...data.learning.session,draft:'wrong'});data.learning=assessLearningState(data.learning,true,now,words)}
 e.sourceQuizId=data.learning.session.syncId
 data.learning.aiEvidence[e.id]={...e,words:e.words.map(w=>({...w,wordId:0}))};data.learning.reviewRequests[r.id]={...r,wordId:0}
 data.learning.reviewSession=createReviewSession(words,data.learning.history,now,()=>0,data.learning.reviewRequests);data.learning.reviewSession.practice=submitAnswer({...data.learning.reviewSession.practice,draft:'wrong'});data.learning=assessReviewState(data.learning,true,now,words)
 const practice=data.learning.reviewSession.practice;data.learning.sessions={[practice.syncId]:{source:'review',practice}}
 const op=operation('migration',diffCells({},encodeData(data,map)),{migrationId:crypto.randomUUID(),expectedRevision:0})
 const imported=await call(op);assert.equal(imported.conflict,false);assert.equal(imported.snapshot.cells['review-request/'+r.id].status,'resolved')
 const before=await snapshot();assert.deepEqual((await call(op)).snapshot,before);assert.equal((await call({...op,id:crypto.randomUUID()})).conflict,true)
 const reset=await call(operation('reset-progress',[]));assert.equal(reset.conflict,false)
 const repeated=await call({...op,id:crypto.randomUUID()});assert.equal(repeated.conflict,true);assert.equal(repeated.snapshot.cells['review-request/'+r.id],undefined);assert.equal(repeated.snapshot.cells['ai-evidence/'+e.id],undefined)
 }finally{await db.close()}
})
test('cross-account vocabulary and fabricated imported resolutions are denied with atomic rollback',async()=>{
 const db=await database()
 try{
 const {call,snapshot}=await fixture(db)
 await db.exec(`reset role;insert into public.profiles(id) values('${other}');insert into public.user_vocabulary(id,user_id,english,turkish_meanings) values('10000000-0000-4000-8000-000000000099','${other}','private',array['özel']);set role authenticated;`)
 await assert.rejects(()=>call(operation('ai-complete',[put('ai-evidence',evidence('u:10000000-0000-4000-8000-000000000099'))])),/Unknown historical vocabulary/)
 const e=evidence(),r={...request(e),status:'resolved',resolvedBy:crypto.randomUUID()},before=await snapshot()
 await assert.rejects(()=>call(operation('migration',[put('ai-evidence',e),put('review-request',r)],{migrationId:crypto.randomUUID(),expectedRevision:before.revision})),/Review evidence/)
 assert.deepEqual(await snapshot(),before)
 }finally{await db.close()}
})
test('Daily Test assessments cannot resolve requests and legacy assessment payloads gain no AI semantics',async()=>{
 const db=await database()
 try{
 const {call,snapshot,add}=await fixture(db),{r}=await add(evidence('b:1')),map=emptyIdentities();let base=(await snapshot()).cells,data=decodeData(base,map,now)
 const save=async(kind)=>{const practice=data.learning.session;data.learning.sessions={[practice.syncId]:{source:'daily',practice}};const op=operation(kind,diffCells(base,encodeData(data,map))),result=await call(op);assert.equal(result.conflict,false);base=result.snapshot.cells;return op}
 data.learning.session=createSession(data.learning.history,now,()=>0);await save('start');data.learning.session=submitAnswer({...data.learning.session,draft:'wrong'});await save('submit')
 data.learning=assessLearningState(data.learning,true,now,words);const result=data.learning.session.results[0];assert.equal('b:'+result.wordId,r.wordId)
 result.resolvedReviewRequestIds=[r.id];await assert.rejects(()=>save('assess'),/Only Review/)
 delete result.resolvedReviewRequestIds;const accepted=await save('assess');assert.equal((await snapshot()).cells['review-request/'+r.id].status,'active')
 assert.equal((await call({...accepted,id:crypto.randomUUID(),protocol:4})).conflict,false);assert.equal((await snapshot()).cells['review-request/'+r.id].status,'active')
 }finally{await db.close()}
})
test('application-generated compact checkpoints sync end to end without unrelated learning fields',async()=>{
 const db=await database();let app
 try{
 const {call,snapshot}=await fixture(db),map=emptyIdentities(),data=decodeData({},map,now)
 data.learning.session=createSession(data.learning.history,now,()=>0,'turkishToEnglish')
 while(data.learning.session.phase!=='completed'){data.learning.session=submitAnswer({...data.learning.session,draft:'wrong'});data.learning=assessLearningState(data.learning,true,now,words)}
 const imported=await call(operation('migration',diffCells({},encodeData(data,map)),{migrationId:crypto.randomUUID(),expectedRevision:0}));assert.equal(imported.conflict,false)
 const {Application}=await import('../src/data/application.ts'),{memoryStorage}=await import('../src/data/localRepository.ts'),{PracticeService}=await import('../src/aiPractice/practiceService.ts'),{MockPracticeProvider}=await import('../src/aiPractice/mockProvider.ts')
 app=new Application(memoryStorage(),{project:'sql-checkpoints',transport:{pull:snapshot,push:op=>call({...op,accountId:owner})}});app.online=true;await app.setUser({id:owner});app.chooseAccount();app.sync.setOnline(false)
 const service=new PracticeService({quiz:app.current.learning.session,history:app.current.learning.history,catalog:words,mode:'voiceAnswer',provider:new MockPracticeProvider()});await service.start();await service.submit('wrong');await service.end();const session=service.getSnapshot(),history=structuredClone(app.current.learning.history)
 await app.completeAIPractice(session);await app.requestReview(session.id,[session.targets[0].wordId]);assert.deepEqual(app.sync.cache.queue.map(op=>op.changes.map(c=>c.key.split('/')[0])),[['ai-evidence'],['review-request']])
 app.sync.offline=false;await app.sync.flush();assert.equal(app.sync.cache.queue.length,0,app.sync.error);assert.deepEqual(app.current.learning.history,history)
 const saved=await snapshot();assert.equal(saved.cells['ai-evidence/'+session.id].sourceQuizId,data.learning.session.syncId);assert.equal(Object.keys(saved.cells).filter(key=>key.startsWith('review-request/')).length,1)
 assert.equal((await app.completeAIPractice(session)).synchronized,true);service.dispose()
 }finally{app?.sync?.dispose();if(app)await app.setUser(null);await db.close()}
})
