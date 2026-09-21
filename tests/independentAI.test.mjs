import test from 'node:test'
import assert from 'node:assert/strict'
import {selectIndependentTargets} from '../src/aiPractice/targetWordSelector.ts'
import {emptyLearningState,parseLearningState} from '../src/learningState.ts'
import {recordAssessment,DAY_MS} from '../src/learningHistory.ts'
import {buildPracticeContext} from '../src/aiPractice/contextBuilder.ts'
import {PracticeService} from '../src/aiPractice/practiceService.ts'
import {MockPracticeProvider} from '../src/aiPractice/mockProvider.ts'
import {OpenAIPracticeProvider} from '../src/aiPractice/openAIProvider.ts'
import {compactEvidence,parseEvidence} from '../src/aiPractice/learningEvidence.ts'
import {parseRequest} from '../supabase/functions/ai-practice/contract.ts'
import {VoiceSession} from '../src/aiPractice/voiceSession.ts'
const catalog=Array.from({length:10},(_,id)=>({id,english:['achieve','avoid','improve'][id]??'word '+id,turkishMeanings:['anlam '+id],tags:[],createdAt:null}))
const now=30*DAY_MS,id=()=>crypto.randomUUID()
const tick=()=>new Promise(r=>setImmediate(r))
test('independent selection starts with no quiz, is bounded, frozen and deterministic',()=>{
 const state=emptyLearningState(catalog,now),before=structuredClone(state)
 const first=selectIndependentTargets(catalog,state,now)
 assert.equal(first.length,8);assert.equal(new Set(first.map(t=>t.wordId)).size,8)
 assert.deepEqual(selectIndependentTargets(catalog,state,now),first);assert.deepEqual(state,before)
 assert.equal(selectIndependentTargets(catalog.slice(0,2),state,now).length,2)
 assert.deepEqual(selectIndependentTargets([],state,now),[])
 catalog[0].turkishMeanings.push('temporary');assert(!first[0].snapshot.word.turkishMeanings.includes('temporary'));catalog[0].turkishMeanings.pop()
 const context=buildPracticeContext(first,'conversation');assert(!('quiz' in context.targets[0]))
 assert.doesNotThrow(()=>parseRequest({action:'prepare',sessionId:id(),requestId:id(),attemptId:id(),context,turns:[]}))
})
test('requests and normal eligibility precede weak directions, manual choice rejects removed and duplicate IDs',()=>{
 const state=emptyLearningState(catalog,now)
 state.reviewRequests.x={wordId:7,direction:'turkishToEnglish',status:'active'}
 state.history[6]=recordAssessment(state.history[6],false,now,'englishToTurkish')
 const targets=selectIndependentTargets(catalog,state,now)
 assert(targets.slice(0,2).some(t=>t.wordId===7));assert.equal(targets.find(t=>t.wordId===7).direction,'turkishToEnglish')
 assert.deepEqual(selectIndependentTargets(catalog,state,now,[7]).map(t=>t.wordId),[7])
 for(const selected of [[],[0,0],[999],catalog.map(w=>w.id)])assert.throws(()=>selectIndependentTargets(catalog,state,now,selected))
 assert(!selectIndependentTargets(catalog.filter(w=>w.id!==7),state,now).some(t=>t.wordId===7))
})
test('independent completion whitelists versioned provenance, leaves learning state unchanged and round trips',async()=>{
 const state=emptyLearningState(catalog,now),before=structuredClone(state),targets=selectIndependentTargets(catalog,state,now,[0])
 const s=new PracticeService({start:{targets,sourceQuizId:null,provenance:'manual'},catalog,history:state.history,mode:'conversation',provider:new MockPracticeProvider(),now:()=>now})
 await s.start();await s.submit('I achieve my goal.');await s.end()
 const e=compactEvidence(s.getSnapshot(),0,now)
 assert.equal(e.schemaVersion,2);assert.equal(e.provenance,'manual');assert.equal(e.sourceQuizId,null);assert.equal(e.inputModality,'text')
 assert.doesNotMatch(JSON.stringify(e),/goal|turns|corrections|explanation/);assert.deepEqual(state,before)
 assert.deepEqual(parseLearningState({...state,aiEvidence:{[e.id]:e}},catalog,now).aiEvidence[e.id],e)
 const legacy={...e};delete legacy.schemaVersion;delete legacy.provenance;delete legacy.inputModality
 assert.deepEqual(parseEvidence(legacy),legacy)
 for(const patch of [{schemaVersion:3},{provenance:'bad'},{inputModality:'audio'},{sourceQuizId:id()},{inputModality:'voice'}])assert.equal(parseEvidence({...e,...patch}),null)
 s.dispose()
})
function voiceFixture(overrides={}){
 let emit,closeCount=0,disposed=0;const events=[]
 const connector=async(fn,signal,history,microphone)=>{emit=fn;events.push({signal,history});microphone('granted');return {close:async()=>{closeCount++;return true},dispose:()=>disposed++,mute:()=>{},...overrides}}
 const voice=new VoiceSession(connector,id,()=>now)
 return {voice,events,emit:e=>emit(e),counts:()=>({closeCount,disposed})}
}
const fragment=(event_id,delta,start,role='input')=>({type:`session.${role}_transcript.delta`,event_id,delta,start_ms:start,end_ms:start+100})
test('voice groups timestamped fragments, deduplicates, excludes tutor and misheard evidence, never writes before evaluation',async()=>{
 const f=voiceFixture();await f.voice.start()
 f.emit(fragment('later',' my goal.',500));f.emit(fragment('earlier','I achieve',100));f.emit(fragment('later',' my goal.',500));f.emit(fragment('tutor','Great.',200,'output'));f.emit(fragment('misheard','wrong recognition',2000))
 assert.equal(f.voice.getSnapshot().turns.length,3)
 const learner=f.voice.getSnapshot().turns.filter(t=>t.role==='learner');assert.equal(learner[0].text,'I achieve my goal.')
 f.emit({type:'activity',learner:true,tutor:true});assert.equal(f.voice.getSnapshot().status,'interrupted')
 await f.voice.end();assert.equal(f.voice.getSnapshot().confirmed,true)
 const turns=f.voice.finalized(new Set([learner[1].id]));assert.equal(turns.length,1)
 let calls=0;const mock=new MockPracticeProvider(),state=emptyLearningState(catalog,now)
 const service=new PracticeService({start:{targets:selectIndependentTargets(catalog,state,now,[0]),sourceQuizId:null,provenance:'automatic',inputModality:'voice'},catalog,history:state.history,mode:'conversation',provider:new OpenAIPracticeProvider(async body=>{calls++;assert.equal(body.action,'finish');return mock.finish(body,new AbortController().signal)})})
 assert.equal(calls,0);await service.evaluateVoice(turns);await service.evaluateVoice(turns);assert.equal(calls,1)
 const e=compactEvidence(service.getSnapshot(),0,now);assert.equal(e.inputModality,'voice');assert.equal(e.evaluator,'openai')
 assert.deepEqual(f.counts(),{closeCount:1,disposed:1});service.dispose();f.voice.dispose()
})
test('voice explicit reconnect retains turn IDs, ignores old events and requires confirmed closure',async()=>{
 const f=voiceFixture();await f.voice.start();f.emit(fragment('one','achieve',0));const turn=f.voice.getSnapshot().turns[0]
 await f.voice.end();await f.voice.reconnect();assert.equal(f.events.length,2);assert.equal(f.events[1].history[0].id,turn.id)
 f.voice.dispose();f.emit(fragment('late','ignored',3000));assert.equal(f.voice.getSnapshot().turns.length,1)
 const failed=voiceFixture({close:async()=>false});await failed.voice.start();await failed.voice.end();await failed.voice.reconnect();assert.equal(failed.events.length,1);failed.voice.dispose()
})
test('microphone failure, cancellation during connection, bounded transcripts and stale results are safe',async()=>{
 const denied=new VoiceSession(async(_emit,_signal,_history,mic)=>{mic('denied');throw Error('secret')});await denied.start();assert.equal(denied.getSnapshot().microphone,'denied');assert(!denied.getSnapshot().error.includes('secret'));denied.dispose()
 let resolve,disposed=0;const pending=new VoiceSession(()=>new Promise(r=>resolve=r));const starting=pending.start();pending.dispose();resolve({dispose:()=>disposed++,close:async()=>true,mute:()=>{}});await starting;assert.equal(disposed,1)
 const f=voiceFixture();await f.voice.start();for(let i=0;i<17;i++)f.emit(fragment('f'+i,'achieve',i*2000));await tick();assert.equal(f.voice.getSnapshot().status,'ended');assert.equal(f.voice.finalized(new Set()).length,16);f.voice.dispose()
})

test('version-2 independent evidence preserves metadata through account word-reference and import round trips',async()=>{
 const {Application}=await import('../src/data/application.ts'),{memoryStorage}=await import('../src/data/localRepository.ts')
 const {encodeData,decodeData,emptyIdentities}=await import('../src/data/codec.ts'),{prepareMigration}=await import('../src/data/migration.ts')
 const custom=[{...catalog[0],id:1000000}],learning=emptyLearningState(custom,now),evidence={schemaVersion:2,provenance:'manual',inputModality:'voice',id:id(),sourceQuizId:null,completedAt:now,mode:'conversation',evaluator:'openai',epoch:0,words:[{wordId:1000000,direction:'turkishToEnglish',outcome:'notAttempted',retrieval:'unassessed',semantic:'unassessed',grammar:'unassessed',suggested:false}]}
 learning.aiEvidence[evidence.id]=evidence
 const base=new Application(memoryStorage()).current,data={...base,vocabulary:{...base.vocabulary,entries:custom,nextId:1000001},learning}
 const map=emptyIdentities(),cells=encodeData(data,map),other=emptyIdentities();other.nextId=2000000
 const round=decodeData(cells,other).learning.aiEvidence[evidence.id]
 assert.equal(round.schemaVersion,2);assert.equal(round.provenance,'manual');assert.equal(round.inputModality,'voice');assert.equal(round.sourceQuizId,null);assert.equal(round.id,evidence.id);assert.equal(round.words[0].wordId,2000000)
 const preview=prepareMigration(data,{'learning/epoch':3},map,{})
 assert.equal(preview.cells['ai-evidence/'+evidence.id].epoch,3);assert.equal(preview.cells['ai-evidence/'+evidence.id].provenance,'manual');assert.match(preview.cells['ai-evidence/'+evidence.id].words[0].wordId,/^u:/)
})

test('explicit independent start takes precedence over an optional legacy quiz argument',()=>{
 const state=emptyLearningState(catalog,now)
 const service=new PracticeService({quiz:{syncId:id()},start:{targets:selectIndependentTargets(catalog,state,now,[0]),sourceQuizId:null,provenance:'automatic'},catalog,history:state.history,mode:'conversation',provider:new MockPracticeProvider()})
 assert.equal(service.getSnapshot().sourceQuizId,null);service.dispose()
})
