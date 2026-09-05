import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTags, validateEntry } from '../src/wordFields.ts'
import { parseUserVocabulary, combinedCatalog, readUserVocabulary, saveImportedWords, saveEditedWord, USER_VOCABULARY_KEY } from '../src/userVocabulary.ts'
import { parseVocabulary, classifyPreview } from '../src/vocabularyImport.ts'
import { emptyFilters, queryCatalog, vocabularyCounts } from '../src/catalogQuery.ts'
import { emptyHistory, emptyWordHistory, recordAssessment, DAY_MS } from '../src/learningHistory.ts'
import { createSession, submitAnswer, parseSession } from '../src/dailyTestModel.ts'
import { emptyLearningState, assessLearningState, assessReviewState, parseLearningState, LEARNING_STATE_KEY } from '../src/learningState.ts'
import { createReviewSession } from '../src/reviewModel.ts'
import { cleanupDeletedWords, deletePersonalWord, deletionBlock, removeDeletedHistory } from '../src/vocabularyDeletion.ts'
const now = 50 * DAY_MS
function storage() { const data = new Map(); return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)} }
const entry = (id,english,tags=[]) => ({id,english,turkishMeanings:['anlam'],tags,createdAt:null})

test('tags normalize Unicode and whitespace; legacy topics and explicit empty arrays migrate idempotently',()=>{
  assert.deepEqual(normalizeTags([' Travel ','TRAVEL','Study   notes','café','café','',null]),['Travel','Study notes','café'])
  const old={version:2,nextId:1000010,entries:[{id:1000000,english:'commute',turkish:'işe gidip gelmek',type:'custom POS',topic:'My words'}],overrides:{0:{english:'Hello',turkish:'Merhaba',type:'interjection'}},suppressedBuiltinIds:[30],legacyEntries:[]}
  const migrated=parseUserVocabulary(old)
  assert.equal(migrated.version,4); assert.deepEqual(migrated.entries[0].tags,['My words']);assert.equal(migrated.entries[0].createdAt,null)
  assert.equal(migrated.entries[0].partOfSpeech,'custom POS');assert.deepEqual(migrated.overrides[0].tags,['Everyday'])
  migrated.entries[0].tags=[]
  assert.deepEqual(parseUserVocabulary(JSON.parse(JSON.stringify(migrated))),migrated)
  assert.deepEqual(validateEntry({english:'x',turkish:'y',topic:'Travel',tags:[]}).tags,[])
  assert.deepEqual(validateEntry({english:'x',turkish:'y',topic:'Travel',tags:'bad'}).tags,['Travel'])
})
test('tagged imports support blank POS, keep phrases, and consolidate tags and meanings',()=>{
  const rows=parseVocabulary('commute - işe gidip gelmek -  - Work, Travel\ncommute\tişe gidip gelmek; gidip gelmek\tverb\twork, Everyday')
  assert.equal(rows[0].entry.partOfSpeech,undefined);assert.deepEqual(rows[0].entry.tags,['Work','Travel'])
  const preview=classifyPreview(rows,[]);assert.deepEqual(preview.map(r=>r.status),['Ready','Merge']);assert.deepEqual(preview[1].tagAdditions,['Everyday'])
  const store=storage(),saved=saveImportedWords(store,rows,now)
  assert.equal(saved.added.length,1);assert.equal(saved.added[0].createdAt,now)
  assert.deepEqual(saved.added[0].tags,['Work','Travel','Everyday']);assert.equal(saved.added[0].turkishMeanings.length,2)
  assert.equal(saveImportedWords(store,rows,now+100).added.length,0)
  const before=saved.added[0]
  const tagOnly=saveImportedWords(store,parseVocabulary('commute - işe gidip gelmek -  - Academic'),now+200)
  assert.deepEqual(tagOnly.updated,[before.id]);assert.equal(tagOnly.value.entries[0].createdAt,now)
  assert.equal(classifyPreview(parseVocabulary('commute - işe gidip gelmek -  - academic'),combinedCatalog(tagOnly.value))[0].status,'Duplicate')
  const edited=saveEditedWord(store,before.id,{...before,tags:[],createdAt:123})
  assert.deepEqual(edited.entries[0].tags,[]);assert.equal(edited.entries[0].createdAt,now)
})
test('combined filters use membership overlap, strict difficulty groups, tags OR and cross-field AND',()=>{
  const catalog=[entry(0,'Alpha',['Work']),{...entry(1,'Beta',['Travel']),partOfSpeech:'verb'},entry(2,'Gamma'),entry(3,'Delta',['Work','Travel'])],history=emptyHistory(catalog)
  history[1]=recordAssessment(history[1],true,now)
  history[2]=recordAssessment(history[2],false,now)
  history[3]=recordAssessment(history[3],true,now-2*DAY_MS)
  const run=(patch={},search='')=>queryCatalog(catalog,history,[1,3],{...emptyFilters(),...patch},search,'default',now).map(w=>w.id)
  assert.deepEqual(vocabularyCounts(catalog,history,now),{Total:4,Learned:2,Learning:1,New:1,'Needs Review':2})
  assert.deepEqual(run({status:'Learned'}),[1,3]);assert.deepEqual(run({status:'Needs Review'}),[2,3]);assert.deepEqual(run({difficulty:'Easy'}),[1,3])
  assert.deepEqual(run({tags:['Work','Travel'],status:'Learned',favoritesOnly:true,speech:'verb'}),[1])
  assert.deepEqual(run({untagged:true}),[2]);assert.deepEqual(run({tags:['Work'],untagged:true}),[0,2,3])
  assert.deepEqual(run({speech:'__unspecified'}),[0,2,3]);assert.deepEqual(run({status:'Learning'}),[2])
  assert.deepEqual(run({status:'New'}),[0]);assert.deepEqual(run({status:'Learned'},'gamma'),[])
  assert.deepEqual(queryCatalog(catalog,history,[0],emptyFilters(),'','default',now,'favorites').map(w=>w.id),[0])
  assert.deepEqual(vocabularyCounts([],{},now),{Total:0,Learned:0,Learning:0,New:0,'Needs Review':0})
})
test('discovery search includes all meanings, explicit alternatives, examples, and tags',()=>{
  const word={...entry(0,'Remember',['Academic']),turkishMeanings:['hatırlamak','anımsamak'],englishAlternatives:['recall'],example:'I remember the bright sunshine.'}, h=emptyHistory([word])
  for (const text of ['REMEMBER','RECALL','ANIMSAMAK','SUNSHINE','academic']) assert.equal(queryCatalog([word],h,[],emptyFilters(),text,'default',now).length,1)
  assert.equal(queryCatalog([word],h,[],emptyFilters(),'invented','default',now).length,0)
})
test('sorts are stable, place New after tested difficulty, and order legacy dates without inventing timestamps',()=>{
  const catalog=[entry(0,'Zebra'),entry(1,'apple'),entry(1000000,'Beta'),entry(1000001,'Beta'),{...entry(1000002,'Gamma'),createdAt:now}],h=emptyHistory(catalog)
  h[1]=recordAssessment(h[1],true,now-100)
  h[1000000]=recordAssessment(h[1000000],false,now)
  h[1000001]=recordAssessment(h[1000001],false,now)
  const ids=sort=>queryCatalog(catalog,h,[],emptyFilters(),'',sort,now).map(w=>w.id)
  assert.deepEqual(ids('az'),[1,1000000,1000001,1000002,0]);assert.deepEqual(ids('za'),[0,1000002,1000000,1000001,1])
  assert.deepEqual(ids('hardest'),[1000000,1000001,1,0,1000002]);assert.deepEqual(ids('easiest'),[1,1000000,1000001,0,1000002])
  assert.deepEqual(ids('recent'),[1000002,1000001,1000000,0,1]);assert.deepEqual(ids('reviewed'),[0,1000002,1,1000000,1000001])
  assert.deepEqual(ids('missed'),[1000000,1000001,0,1,1000002]);assert.deepEqual(ids('default'),[0,1,1000000,1000001,1000002])
})
function fixture() {
  const store=storage(),added=saveImportedWords(store,parseVocabulary(Array.from({length:10},(_,i)=>`personal${i} - özel${i}`).join('\n')),now)
  return {store,added,catalog:combinedCatalog(added.value),state:emptyLearningState(combinedCatalog(added.value),now)}
}
test('deletion rejects built-ins and both unfinished sessions including their assessed prefixes',()=>{
  const {store,added,catalog,state}=fixture(),id=added.added[0].id
  assert.throws(()=>deletePersonalWord(store,0,state),/Only personal/)
  state.session=createSession(emptyHistory(added.added),now,()=>0,'englishToTurkish',[],added.added)
  state.session=submitAnswer({...state.session,draft:'x'})
  const next=assessLearningState(state,true,now,catalog),assessed=next.session.results[0].wordId
  assert.match(deletionBlock(assessed,next),/Daily Test/);assert.throws(()=>deletePersonalWord(store,assessed,next),/Finish Daily Test/)
  state.session=null;state.history[id]=recordAssessment(emptyWordHistory(),false,now)
  state.reviewSession=createReviewSession(catalog,state.history,now)
  assert.match(deletionBlock(id,state),/Review/)
  store.setItem(LEARNING_STATE_KEY,JSON.stringify(state))
  assert.throws(()=>deletePersonalWord(store,id,{...state,reviewSession:null}),/Finish Review/)
})
test('deletion removes per-word data and preserves completed snapshots, accuracy and activity',()=>{
  const {store,added,catalog}=fixture();let state=emptyLearningState(catalog,now)
  state.session=createSession(state.history,now,()=>0,'englishToTurkish',[],added.added)
  while(state.session.phase!=='completed') {state={...state,session:submitAnswer({...state.session,draft:'x'})};state=assessLearningState(state,true,now,catalog)}
  const id=state.session.questions[0].wordId
  state.history[id]=recordAssessment(state.history[id],false,now)
  state.reviewSession=createReviewSession(catalog,state.history,now)
  state.reviewSession={...state.reviewSession,practice:submitAnswer({...state.reviewSession.practice,draft:'x'})}
  state=assessReviewState(state,true,now,catalog)
  store.setItem(LEARNING_STATE_KEY,JSON.stringify(state));store.setItem('kelime-favorites',JSON.stringify([0,id]));store.setItem('kelime-learned',JSON.stringify([id]))
  const result=deletePersonalWord(store,id,state),live=combinedCatalog(result.value)
  assert.equal(result.cleanupComplete,true);assert.equal(live.some(w=>w.id===id),false)
  assert.equal(store.getItem('kelime-favorites'),'[0]');assert.equal(store.getItem('kelime-learned'),'[]')
  const restored=parseLearningState(JSON.parse(store.getItem(LEARNING_STATE_KEY)),live,now,live,result.value.deletedIds)
  assert.equal(restored.history[id],undefined);assert.deepEqual(restored.activity,state.activity)
  assert.deepEqual(restored.session,state.session);assert.deepEqual(restored.reviewSession,state.reviewSession)
  assert.equal(parseSession(state.session,live),null)
  assert.deepEqual(removeDeletedHistory(state,[id]).activity,state.activity)
  assert.ok(saveImportedWords(store,parseVocabulary('freshword - taze'),now).added[0].id > id)
})
test('failed deletion commit changes nothing; interrupted cleanup remains deleted and retries',()=>{
  const {store,added,catalog,state}=fixture(),id=added.added[0].id
  state.history[id]=recordAssessment(state.history[id],true,now)
  store.setItem(LEARNING_STATE_KEY,JSON.stringify(state));store.setItem('kelime-favorites',JSON.stringify([id]))
  const before=store.getItem(USER_VOCABULARY_KEY)
  assert.throws(()=>deletePersonalWord({getItem:store.getItem,setItem(){throw Error('quota')}},id,state))
  assert.equal(store.getItem(USER_VOCABULARY_KEY),before)
  const result=deletePersonalWord({getItem:store.getItem,setItem(k,v){if(k!==USER_VOCABULARY_KEY)throw Error('quota');store.setItem(k,v)}},id,state)
  assert.equal(result.cleanupComplete,false);assert.equal(readUserVocabulary(store).entries.some(w=>w.id===id),false)
  const recovered=parseLearningState(JSON.parse(store.getItem(LEARNING_STATE_KEY)),combinedCatalog(result.value),now,catalog,result.value.deletedIds)
  assert.equal(recovered.history[id],undefined)
  assert.equal(cleanupDeletedWords(store,result.value),true);assert.equal(store.getItem('kelime-favorites'),'[]')
  assert.equal(JSON.parse(store.getItem(LEARNING_STATE_KEY)).history[id],undefined)
  assert.equal(cleanupDeletedWords(store,result.value),true)
})
test('markers prevent reintroduction of saved entries and retain ID counter and built-in suppression',()=>{
  const parsed=parseUserVocabulary({version:3,nextId:1000000,entries:[entry(1000050,'x')],legacyEntries:[entry(1000050,'x')],deletedIds:[1000050,1000050,0,'bad'],suppressedBuiltinIds:[30]})
  assert.deepEqual(parsed.entries,[]);assert.deepEqual(parsed.legacyEntries,[]);assert.deepEqual(parsed.deletedIds,[1000050]);assert.equal(parsed.nextId,1000051)
  assert.equal(combinedCatalog(parsed).some(w=>w.id===30),false);assert.equal(combinedCatalog(parsed).some(w=>w.id===0),true)
})
