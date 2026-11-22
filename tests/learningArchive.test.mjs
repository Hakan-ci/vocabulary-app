// Guest storage layout: archived sessions in their own keys ("save only what changed").
import test from 'node:test'
import assert from 'node:assert/strict'
import {loadLocal,saveLocal,ARCHIVE_INDEX_KEY} from '../src/data/localRepository.ts'
import {decodeData,emptyIdentities} from '../src/data/codec.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {assessLearningState,LEARNING_STATE_KEY} from '../src/learningState.ts'
import {combinedCatalog} from '../src/userVocabulary.ts'

const T0=1700000000000
function prng(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}}
function store(){const map=new Map(),writes=[];return {map,writes,getItem:k=>map.has(k)?map.get(k):null,setItem(k,v){writes.push(k);map.set(k,v)}}}
// Plays `count` tests through the model and archives them, as the app does.
function withTests(data,count,seed=1){
  const r=prng(seed),catalog=combinedCatalog(data.vocabulary);let learning=data.learning,now=T0
  const sessions={...learning.sessions}
  for(let t=0;t<count;t++){
    learning={...learning,session:createSession(learning.history,now,r,'mixed',[],catalog)}
    for(let q=0;q<10;q++){learning={...learning,session:submitAnswer({...learning.session,draft:'x'})};learning=assessLearningState(learning,r()<.5,now+=1000,catalog)}
    sessions[learning.session.syncId]={source:'daily',practice:learning.session,archivedAt:now};learning={...learning,session:null}
  }
  return {...data,learning:{...learning,sessions}}
}
const fresh=()=>decodeData({},emptyIdentities(),T0)
const archivedIds=data=>Object.entries(data.learning.sessions??{}).filter(([,r])=>r.archivedAt).map(([id])=>id).sort()
const comparable=data=>JSON.parse(JSON.stringify(data.learning))

test('archived sessions move to their own keys and load back identically',()=>{
  const s=store(),data=withTests(fresh(),3)
  saveLocal(s,data)
  const main=JSON.parse(s.getItem(LEARNING_STATE_KEY))
  assert.deepEqual(Object.values(main.sessions).filter(r=>r.archivedAt),[],'main key holds no archived sessions')
  assert.deepEqual(JSON.parse(s.getItem(ARCHIVE_INDEX_KEY)).sort(),archivedIds(data))
  const loaded=loadLocal(s).data
  assert.deepEqual(comparable(loaded),comparable(loadLocal(s).data))
  assert.deepEqual(archivedIds(loaded),archivedIds(data))
  for(const id of archivedIds(data))assert.deepEqual(JSON.parse(JSON.stringify(loaded.learning.sessions[id])),JSON.parse(JSON.stringify(data.learning.sessions[id])))
})

test('a Daily Test click rewrites only the live state, not past tests',()=>{
  const s=store();saveLocal(s,withTests(fresh(),5))
  let data=loadLocal(s).data
  const catalog=combinedCatalog(data.vocabulary)
  const start={...data,learning:{...data.learning,session:createSession(data.learning.history,T0+9e6,prng(2),'mixed',[],catalog)}}
  s.writes.length=0;saveLocal(s,start,data)
  assert.deepEqual(s.writes,['kelime-local-recovery',LEARNING_STATE_KEY,'kelime-local-recovery'])
  // Archiving that test writes exactly one new record plus the index.
  const archived={...start,learning:{...start.learning,session:null,sessions:{...start.learning.sessions,[start.learning.session.syncId]:{source:'daily',practice:start.learning.session,archivedAt:T0+9e6}}}}
  s.writes.length=0;saveLocal(s,archived,start)
  assert.deepEqual(s.writes,[`${ARCHIVE_INDEX_KEY}:${start.learning.session.syncId}`,ARCHIVE_INDEX_KEY,'kelime-local-recovery',LEARNING_STATE_KEY,'kelime-local-recovery'])
  assert.equal(archivedIds(loadLocal(s).data).length,6)
})

test('upgrading from the single-key format moves past tests out without losing any',()=>{
  const s=store(),data=withTests(fresh(),4)
  s.setItem(LEARNING_STATE_KEY,JSON.stringify(data.learning)) // old format: everything in one key
  const loaded=loadLocal(s).data
  assert.deepEqual(archivedIds(loaded),archivedIds(data))
  saveLocal(s,{...loaded,learning:{...loaded.learning,dailyGoal:20}},loaded)
  assert.equal(Object.values(JSON.parse(s.getItem(LEARNING_STATE_KEY)).sessions).filter(r=>r.archivedAt).length,0)
  assert.deepEqual(archivedIds(loadLocal(s).data),archivedIds(data))
})

test('an older app version writing the main key keeps or adds past tests',()=>{
  const s=store();saveLocal(s,withTests(fresh(),3))
  const before=loadLocal(s).data
  // The old version sees no archived tests, saves its view, then archives a new test into the main key.
  const oldView=JSON.parse(s.getItem(LEARNING_STATE_KEY))
  const added=withTests({...before,learning:{...before.learning,sessions:{}}},1,7)
  s.setItem(LEARNING_STATE_KEY,JSON.stringify({...oldView,sessions:added.learning.sessions}))
  const loaded=loadLocal(s).data
  assert.deepEqual(archivedIds(loaded),[...archivedIds(before),...archivedIds(added)].sort())
  saveLocal(s,{...loaded,learning:{...loaded.learning,dailyGoal:15}},loaded) // new version moves it to the archive
  assert.deepEqual(archivedIds(loadLocal(s).data),archivedIds(loaded))
})

test('clearing progress releases archived records',()=>{
  const s=store(),data=withTests(fresh(),2);saveLocal(s,data)
  const loaded=loadLocal(s).data,ids=archivedIds(loaded)
  saveLocal(s,{...loaded,learning:{...loaded.learning,sessions:{}}},loaded)
  assert.deepEqual(JSON.parse(s.getItem(ARCHIVE_INDEX_KEY)),[])
  for(const id of ids)assert.equal(s.getItem(`${ARCHIVE_INDEX_KEY}:${id}`),'null')
  assert.deepEqual(archivedIds(loadLocal(s).data),[])
})

test('an interrupted save never loses an archived test',()=>{
  const s=store(),data=withTests(fresh(),2);saveLocal(s,data)
  const loaded=loadLocal(s).data,next=withTests(loaded,1,11)
  const failing={...s,setItem(k,v){if(k===LEARNING_STATE_KEY||k==='kelime-local-recovery')throw Error('Quota exceeded');s.setItem(k,v)}}
  assert.throws(()=>saveLocal(failing,next,loaded))
  assert.deepEqual(archivedIds(loadLocal(s).data),archivedIds(next),'the new archived test is already stored')
})
