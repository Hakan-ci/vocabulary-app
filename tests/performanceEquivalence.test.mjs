import test from 'node:test'
import assert from 'node:assert/strict'
import {equal} from '../src/data/models.ts'
import {SyncService,emptyCache} from '../src/data/syncService.ts'
import {memoryStorage,saveLocal} from '../src/data/localRepository.ts'
import {decodeData,encodeData,emptyIdentities} from '../src/data/codec.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {assessLearningState} from '../src/learningState.ts'
import {combinedCatalog} from '../src/userVocabulary.ts'
import {vocabularyRepository} from '../src/data/localRepository.ts'
import {parseVocabulary} from '../src/vocabularyImport.ts'

// The original implementation, kept verbatim as the reference for equivalence.
function canonical(value){return JSON.stringify(value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,JSON.parse(canonical(v))])):Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):value??null)}
const reference=(a,b)=>canonical(a)===canonical(b)

function prng(seed){return()=>{seed=(seed*1664525+1013904223)>>>0;return seed/2**32}}
const leaves=[null,undefined,0,-0,1,2.5,NaN,Infinity,'','a','b','0',true,false]
function value(r,depth=0){
  const roll=r()
  if(depth>3||roll<.45)return leaves[Math.floor(r()*leaves.length)]
  if(roll<.7)return Array.from({length:Math.floor(r()*4)},()=>value(r,depth+1))
  const out={};for(const key of ['x','y','z','1','10','2'])if(r()<.5)out[key]=value(r,depth+1);return out
}
// Same content with keys re-inserted in reverse order, optionally with one leaf changed.
function variant(v,r,mutate){
  if(Array.isArray(v))return v.map(x=>variant(x,r,mutate))
  if(v&&typeof v==='object'){const out={};for(const k of Object.keys(v).reverse())out[k]=variant(v[k],r,mutate);if(mutate&&r()<.15){const keys=Object.keys(out);if(keys.length)out[keys[0]]=leaves[Math.floor(r()*leaves.length)];else out.x=1}return out}
  return mutate&&r()<.15?leaves[Math.floor(r()*leaves.length)]:v
}

test('equal() matches the original canonical-string comparison on random values',()=>{
  const r=prng(1);let equalCount=0
  for(let i=0;i<20000;i++){
    const a=value(r),b=r()<.5?variant(a,r,r()<.5):value(r)
    const expected=reference(a,b);if(expected)equalCount++
    assert.equal(equal(a,b),expected,JSON.stringify({a,b}))
  }
  assert.ok(equalCount>1000,'the sample must exercise the equal branch too')
})

test('equal() edge cases agree with the original',()=>{
  // oxlint-disable-next-line no-sparse-arrays -- a hole must compare like JSON null
  const cases=[[undefined,null],[{a:undefined},{a:null}],[{a:undefined},{}],[[undefined],[null]],[[,1],[null,1]],[NaN,null],[{},[]],['1',1],[0,-0],[{a:1,b:2},{b:2,a:1}],[[1,2],[2,1]],[new Date(1),new Date(2)],[{a:[{b:1}]},{a:[{b:1}]}]]
  for(const [a,b] of cases)assert.equal(equal(a,b),reference(a,b),String(JSON.stringify([a,b])))
})

test('equal() matches the original on real learning state and encoded cells',()=>{
  const r=prng(3);let data=decodeData({},emptyIdentities(),1700000000000);const catalog=combinedCatalog(data.vocabulary)
  let learning=data.learning,now=1700000000000;const states=[learning]
  for(let t=0;t<3;t++){
    learning={...learning,session:createSession(learning.history,now,r,'mixed',[],catalog)};states.push(learning)
    for(let q=0;q<10;q++){learning={...learning,session:submitAnswer({...learning.session,draft:'x'})};states.push(learning);learning=assessLearningState(learning,r()<.5,now+=1000,catalog);states.push(learning)}
  }
  for(let i=1;i<states.length;i++){
    assert.equal(equal(states[i-1],states[i]),reference(states[i-1],states[i]))
    assert.equal(equal(states[i],structuredClone(states[i])),true)
    const before=encodeData({...data,learning:states[i-1]},emptyIdentities()),after=encodeData({...data,learning:states[i]},emptyIdentities())
    for(const key of new Set([...Object.keys(before),...Object.keys(after)]))assert.equal(equal(before[key],after[key]),reference(before[key],after[key]),key)
  }
})

test('persist() writes a point-in-time JSON snapshot of the cache',async()=>{
  const saved=[],store={async load(){return emptyCache()},async save(_key,value){saved.push(value)}}
  const sync=new SyncService(memoryStorage(),'k',{async pull(){return {revision:0,cells:{}}},async push(){throw Error('offline')}},store,emptyCache())
  sync.offline=true
  sync.cache.base.cells={'favorite/b:1':true};sync.persist(false);const expected=JSON.stringify(sync.cache)
  sync.cache.base.cells['favorite/b:2']=true // mutate after persist: must not leak into the queued write
  await sync.whenDurable()
  assert.equal(saved[0],expected);assert.equal(sync.storageError,false)
  sync.cache.base.cells.bad=10n;sync.persist(false);assert.equal(await sync.whenDurable(),false) // unserializable → storage error, as before
  sync.dispose()
})

test('decodeData identity resolution keeps first-match and new-ID semantics',()=>{
  const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333'
  // a appears twice (first in Object.entries order wins); b and c are new to the map.
  const map={nextId:1_000_000,localToCloud:{1000005:a,1000002:a,1000000:'44444444-4444-4444-8444-444444444444'}}
  const word=(english)=>({english,turkishMeanings:['x'],tags:[],createdAt:1})
  const cells={[`word/u:${b}`]:word('bee'),[`word/u:${a}`]:word('ay'),[`favorite/u:${c}`]:true,[`favorite/u:${a}`]:true,[`favorite/u:${b}`]:true}
  const data=decodeData(cells,map,1700000000000)
  const ids=Object.fromEntries(data.vocabulary.entries.map(w=>[w.english,w.id]))
  assert.equal(ids.ay,1000002)
  assert.equal(ids.bee,1000001) // first free id after skipping the occupied 1000000
  assert.deepEqual(data.favorites,[1000002,1000001]) // a and b reuse their ids; c has no word entry, so it is not a valid favorite
  assert.equal(map.localToCloud[1000001],b);assert.equal(map.localToCloud[1000003],c)
})

test('saveLocal writes exactly the same bytes as the original double-serializing version',()=>{
  const original=(storage,data,previous)=>{const entries={}
    if(data.vocabulary!==previous?.vocabulary)entries['kelime-user-vocabulary']=data.vocabulary
    if(data.learning!==previous?.learning)entries['kelime-learning-state']=data.learning
    if(data.favorites!==previous?.favorites)entries['kelime-favorites']=data.favorites
    storage.setItem('kelime-local-recovery',JSON.stringify({version:2,entries}))
    for(const [key,value] of Object.entries(entries))storage.setItem(key,JSON.stringify(value))
    storage.setItem('kelime-local-recovery','null')}
  const recorder=()=>{const writes=[];return {writes,getItem:()=>null,setItem:(k,v)=>writes.push([k,v])}}
  const r=prng(5);let data=decodeData({},emptyIdentities(),1700000000000);const catalog=combinedCatalog(data.vocabulary)
  data={...data,favorites:[0,3],learning:{...data.learning,session:createSession(data.learning.history,1700000000000,r,'mixed',[],catalog)}}
  const changedLearning={...data,learning:{...data.learning,dailyGoal:20}}
  for(const [next,previous] of [[data,undefined],[changedLearning,data],[{...data,favorites:[1]},data],[data,data]]){
    const a=recorder(),b=recorder();saveLocal(a,next,previous);original(b,next,previous)
    assert.deepEqual(a.writes,b.writes)
  }
})

test('encodeData reuses archived-session encodings only while they are still valid',()=>{
  const r=prng(9);let data=decodeData({},emptyIdentities(),1700000000000)
  data=vocabularyRepository.import(data,parseVocabulary('commute - işe gidip gelmek - verb - Work\nharbor - liman - noun')).data
  const catalog=combinedCatalog(data.vocabulary);let learning=data.learning,now=1700000000000;const sessions={}
  for(let t=0;t<3;t++){learning={...learning,session:createSession(learning.history,now,r,'mixed',[],catalog)}
    for(let q=0;q<10;q++){learning={...learning,session:submitAnswer({...learning.session,draft:'x'})};learning=assessLearningState(learning,true,now+=1000,catalog)}
    sessions[learning.session.syncId]={source:'daily',practice:learning.session,archivedAt:now};learning={...learning,session:null}}
  data={...data,learning:{...learning,sessions}}
  const map=emptyIdentities(),first=encodeData(data,map),second=encodeData(data,map)
  const fresh=encodeData(structuredClone(data),structuredClone(map)) // new objects: no memo hits
  assert.deepEqual(second,first);assert.deepEqual(second,fresh)
  const key=Object.keys(second).find(k=>k.startsWith('session-record/'))
  assert.equal(second[key],first[key],'unchanged archived record reuses its encoding');assert.ok(Object.isFrozen(second[key]))
  // A changed identity mapping for a referenced personal word forces a fresh encode.
  const personal=Number(Object.keys(map.localToCloud)[0]),moved=structuredClone(map);moved.localToCloud[personal]='99999999-9999-4999-8999-999999999999'
  const remapped=encodeData(data,moved)
  const usesPersonal=Object.keys(remapped).filter(k=>k.startsWith('session-record/')&&JSON.stringify(remapped[k]).includes('99999999'))
  assert.deepEqual(remapped,encodeData(structuredClone(data),structuredClone(moved)))
  if(Object.values(sessions).some(s=>s.practice.questions.some(q=>q.wordId===personal)))assert.ok(usesPersonal.length>0)
  // An in-place edit that changes the fingerprint is not served from the memo.
  const record=Object.values(data.learning.sessions)[0];record.archivedAt+=1
  assert.equal(encodeData(data,map)[`session-record/${record.practice.syncId}`].archivedAt,record.archivedAt)
})
