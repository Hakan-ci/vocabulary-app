import test from 'node:test'
import assert from 'node:assert/strict'
import {decodeData,encodeData,emptyIdentities,reference} from '../src/data/codec.ts'
import {memoryStorage,loadLocal,saveLocal,vocabularyRepository} from '../src/data/localRepository.ts'
import {SyncService,projection,applyChanges,cacheKey,parseCache,emptyCache} from '../src/data/syncService.ts'
import {prepareMigration,duplicateCandidates} from '../src/data/migration.ts'
import {Application} from '../src/data/application.ts'
import {clientConfiguration} from '../src/data/supabaseClient.ts'
import {parseVocabulary} from '../src/vocabularyImport.ts'
import {createSession,submitAnswer} from '../src/dailyTestModel.ts'
import {assessLearningState} from '../src/learningState.ts'
import {combinedCatalog} from '../src/userVocabulary.ts'
import {equal} from '../src/data/models.ts'
Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
function remote(initial={}) {
 let state={revision:0,cells:structuredClone(initial)}, fail=false, lost=false
 const receipts=new Set()
 return {get state(){return state},set fail(v){fail=v},set lost(v){lost=v},
 async pull(){if(fail)throw Error('Network unavailable');return structuredClone(state)},
 async push(op){if(fail)throw Error('Network unavailable');if(receipts.has(op.id))return {conflict:false,snapshot:structuredClone(state)}
 if(op.expectedRevision!==undefined&&op.expectedRevision!==state.revision||op.changes.some(c=>!equal(state.cells[c.key]??null,c.before)))return {conflict:true,snapshot:structuredClone(state)}
 state={revision:state.revision+1,cells:applyChanges(state.cells,op.changes)};receipts.add(op.id)
 if(lost){lost=false;throw Error('Response lost')}
 return {conflict:false,snapshot:structuredClone(state)}}}
}
const fresh=()=>decodeData({},emptyIdentities(),1700000000000)
const imported=()=>vocabularyRepository.import(fresh(),parseVocabulary('commute - işe gidip gelmek - verb - Work')).data

test('missing or private Supabase configuration stays local; public keys are accepted',()=>{
 assert.equal(clientConfiguration({}),null)
 assert.equal(clientConfiguration({VITE_SUPABASE_URL:'bad',VITE_SUPABASE_ANON_KEY:'public'}),null)
 assert.equal(clientConfiguration({VITE_SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_ANON_KEY:'sb_secret_no'}),null)
 assert.ok(clientConfiguration({VITE_SUPABASE_URL:'https://test.supabase.co',VITE_SUPABASE_ANON_KEY:'sb_publishable_demo'}))
})
test('codec preserves personal IDs, meanings, directional histories, independent sessions and overrides',()=>{
 let data=imported();const id=data.vocabulary.entries[0].id,catalog=combinedCatalog(data.vocabulary)
 data.favorites=[id,0];data.vocabulary.overrides[0]={...catalog[0],example:'Local override'}
 data.learning.session=createSession(data.learning.history,1700000000000,()=>0,'mixed',[],catalog)
 data.learning.session=submitAnswer({...data.learning.session,draft:'wrong'})
 data.learning=assessLearningState(data.learning,true,1700000000100,catalog)
 const map=emptyIdentities(),cells=encodeData(data,map),restored=decodeData(cells,map)
 assert.deepEqual(restored,data)
 const other=decodeData(cells,emptyIdentities());assert.equal(other.vocabulary.entries[0].english,'commute')
 assert.equal(Object.keys(cells).filter(k=>k.startsWith('word/')).length,2)
})
test('migration uses a separate identity map, explicit duplicate decisions, and unsummed history conflicts',()=>{
 const guest=imported(),account=imported(),accountMap=emptyIdentities(),guestMap=emptyIdentities()
 account.vocabulary.entries[0].english='unrelated';const cloud=encodeData(account,accountMap)
 let preview=prepareMigration(guest,cloud,guestMap,{},{});const localRef=reference(1000000,guestMap)
 assert.notEqual(localRef,reference(1000000,accountMap));assert.equal(preview.cells[`word/${localRef}`].english,'commute')
 assert.equal(Object.keys(preview.cells).filter(k=>k.startsWith('word/')).length,2)
 account.vocabulary.entries[0].english='commute';const matching=encodeData(account,accountMap)
 assert.equal(duplicateCandidates(guest,matching).length,1)
 const original=guestMap.localToCloud[1000000]
 prepareMigration(guest,matching,guestMap,{1000000:reference(1000000,accountMap)})
 assert.equal(guestMap.localToCloud[1000000],original,'link choice never corrupts original mapping')
 preview=prepareMigration(guest,matching,guestMap,{1000000:'new'})
 assert.ok(preview.cells[`word/u:${original}`])
 guest.learning.dailyGoal=20;preview=prepareMigration(guest,matching,guestMap,{1000000:'new'})
 assert.ok(preview.conflicts.some(c=>c.key==='setting/goal'))
 assert.equal(prepareMigration(guest,matching,guestMap,{1000000:'new'},{'setting/goal':'device'}).cells['setting/goal'],20)
})
test('offline operations survive refresh and lost-response retries apply exactly once',async()=>{
 const storage=memoryStorage(),server=remote(),key=cacheKey('project','A')
 let sync=new SyncService(storage,key,server);await sync.initialize();sync.setOnline(false)
 sync.enqueue('favorite',{}, {'favorite/b:0':true});assert.equal(sync.status,'Offline');sync.dispose()
 sync=new SyncService(storage,key,server);server.lost=true
 await sync.flush();assert.equal(sync.cache.queue.length,1);assert.equal(server.state.revision,1)
 await sync.flush();assert.equal(sync.cache.queue.length,0);assert.equal(server.state.revision,1);sync.dispose()
})
test('conflicts retain divergent actions, while unrelated changes synchronize',async()=>{
 const server=remote(),storage=memoryStorage(),a=new SyncService(storage,'A',server),b=new SyncService(storage,'B',server)
 await a.initialize();await b.initialize();a.setOnline(false);b.setOnline(false)
 a.enqueue('preferences',{}, {'setting/goal':15});b.enqueue('preferences',{}, {'setting/goal':20})
 a.offline=false;await a.flush();b.enqueue('favorite',projection(b.cache),{...projection(b.cache),'favorite/b:1':true});b.offline=false;await b.flush()
 assert.equal(b.cache.queue[0].status,'conflict');assert.equal(server.state.cells['favorite/b:1'],true)
 b.resolve(b.cache.queue[0].id,'account');assert.equal(b.cache.backups.length,1);assert.equal(server.state.cells['setting/goal'],15)
 a.dispose();b.dispose()
})
test('storage failures retain actions in memory and do not claim durable synchronization',async()=>{
 const server=remote(),storage={getItem:()=>null,setItem:()=>{throw Error('Quota')}}
 const sync=new SyncService(storage,'key',server);sync.setOnline(false);sync.enqueue('favorite',{}, {'favorite/b:2':true})
 assert.equal(sync.storageError,true);assert.equal(projection(sync.cache)['favorite/b:2'],true);sync.dispose()
})
test('account switches preserve guest storage and isolate queued changes by account',async()=>{
 const storage=memoryStorage(),guest=imported();guest.favorites=[0];saveLocal(storage,guest)
 const server=remote(),app=new Application(storage,{project:'test-project',transport:server})
 await app.setUser({id:'A',email:'a@example.test'});assert.equal(app.scope,'guest');assert.equal(app.migrationOpen,true)
 app.cancelMigration();assert.equal(app.current.favorites[0],0);app.chooseAccount();app.sync.setOnline(false)
 app.saveFavorites([1]);assert.deepEqual(loadLocal(storage).data.favorites,[0]);assert.deepEqual(app.current.favorites,[1])
 await app.setUser(null);assert.deepEqual(app.current.favorites,[0]);await app.setUser({id:'B'});assert.equal(app.scope,'guest');app.chooseAccount();assert.deepEqual(app.current.favorites,[])
 await app.setUser({id:'A'});app.sync.setOnline(false);assert.deepEqual(app.current.favorites,[1]);app.sync.dispose()
})
test('approved migration persists a backup, retries once, and never uploads before confirmation',async()=>{
 const storage=memoryStorage();saveLocal(storage,imported());const server=remote(),app=new Application(storage,{project:'migration',transport:server})
 await app.setUser({id:'A'});app.previewMigration();assert.equal(server.state.revision,0);assert.ok(storage.getItem('kelime-device-dataset-id'))
 for(const c of app.preview.conflicts)app.chooseConflict(c.key,'device')
 app.sync.setOnline(false);app.commitMigration();assert.equal(server.state.revision,0);app.sync.offline=false;await app.sync.flush()
 assert.equal(app.sync.cache.migrationChoice,'imported');assert.equal(server.state.revision,1);assert.equal(loadLocal(storage).data.vocabulary.entries.length,1);app.sync.dispose()
})

test('malformed account identity maps and pending records are rejected without overwriting their copy',()=>{
 const cache=emptyCache();cache.identities.localToCloud[1000000]='broken';cache.identities.nextId=1000001
 const storage=memoryStorage();const raw=JSON.stringify(cache);storage.setItem('bad',raw)
 assert.throws(()=>new SyncService(storage,'bad',remote()),/identities/);assert.equal(storage.getItem('bad'),raw)
 assert.throws(()=>parseCache('{bad'),SyntaxError)
})
