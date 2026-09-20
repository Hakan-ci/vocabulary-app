import test from 'node:test'
import assert from 'node:assert/strict'
import {SyncService,emptyCache,parseCache,projection,applyChanges,cacheKey} from '../src/data/syncService.ts'
import {memoryStorage,saveLocal,recoverLocal,loadLocal} from '../src/data/localRepository.ts'
import {classifySyncError} from '../src/data/syncErrors.ts'
import {decodeData,emptyIdentities} from '../src/data/codec.ts'
import {Application} from '../src/data/application.ts'
Object.defineProperty(navigator,'onLine',{value:true,configurable:true})
const operation=(kind='favorite',key='favorite/b:0',before=null,after=true)=>({id:crypto.randomUUID(),protocol:4,kind,at:Date.now(),changes:[{key,before,after}],status:'pending'})
function server(){let snapshot={revision:0,cells:{}},active=0;const receipts=new Set(),sent=[];return {sent,get active(){return active},async pull(){return structuredClone(snapshot)},async push(op){active++;assert.equal(active,1);sent.push(structuredClone(op));await Promise.resolve();if(!receipts.has(op.id)){snapshot={revision:snapshot.revision+1,cells:applyChanges(snapshot.cells,op.changes)};receipts.add(op.id)}active--;return {conflict:false,snapshot:structuredClone(snapshot)}}}}
test('unsent state toggles coalesce, but event operations and attempted payloads are immutable',async()=>{
 const remote=server(),sync=new SyncService(memoryStorage(),'x',remote);sync.setOnline(false)
 const id=sync.enqueue('favorite',{}, {'favorite/b:0':true})
 sync.enqueue('favorite',projection(sync.cache),{'favorite/b:0':false})
 assert.equal(sync.cache.queue.length,1);assert.equal(sync.cache.queue[0].id,id);assert.equal(sync.cache.queue[0].changes[0].before,null)
 sync.enqueue('assess',projection(sync.cache),{...projection(sync.cache),'event/1':1});sync.enqueue('assess',projection(sync.cache),{...projection(sync.cache),'event/2':2})
 assert.equal(sync.cache.queue.length,3)
 sync.offline=false;await Promise.all([sync.flush(),sync.flush(),sync.flush()]);assert.equal(remote.sent.length,3);assert.equal(sync.counts.pending,0);assert.equal(sync.status,'Synced');sync.dispose()
})
test('a lost response retries the same ID and payload even after a new state mutation',async()=>{
 const remote=server();let lost=true;const transport={pull:remote.pull,async push(op){const result=await remote.push(op);if(lost){lost=false;throw Error('Response lost')}return result}}
 const sync=new SyncService(memoryStorage(),'x',transport);sync.setOnline(false);sync.enqueue('favorite',{}, {'favorite/b:0':true});sync.offline=false;await sync.flush()
 sync.enqueue('favorite',projection(sync.cache),{'favorite/b:0':false});assert.equal(sync.cache.queue.length,2)
 await sync.flush();assert.deepEqual(remote.sent[0].wirePayload,remote.sent[1].wirePayload);assert.equal(remote.sent[0].id,remote.sent[1].id);assert.equal((await remote.pull()).revision,2);sync.dispose()
})
test('new mutations and background triggers cannot bypass exponential backoff',async()=>{
 let calls=0;const sync=new SyncService(memoryStorage(),'x',{async pull(){return {revision:0,cells:{}}},async push(){calls++;throw Error('Offline')}})
 sync.setOnline(false);sync.enqueue('favorite',{}, {'favorite/b:0':true});sync.offline=false;await sync.flush();assert.equal(calls,1)
 sync.enqueue('preferences',projection(sync.cache),{...projection(sync.cache),'setting/goal':15});await sync.flush(false);assert.equal(calls,1);assert.equal(sync.cache.queue[0].retryCount,1)
 assert.ok(sync.cache.queue[0].nextRetryAt>Date.now());sync.dispose()
})
test('eight automatic failures stop retrying and manual retry can recover',async()=>{
 let calls=0;const sync=new SyncService(memoryStorage(),'x',{async pull(){return {revision:0,cells:{}}},async push(){calls++;throw Error('Offline')}})
 sync.setOnline(false);sync.enqueue('favorite',{}, {'favorite/b:0':true});sync.offline=false
 for(let i=0;i<8;i++){sync.retryAt=0;await sync.flush(false)}
 assert.equal(calls,8);assert.equal(sync.cache.queue[0].status,'failed');sync.retryAt=0;await sync.flush(false);assert.equal(calls,8)
 await sync.flush();assert.equal(calls,9);sync.dispose()
})
test('durability failure prevents any upload and a manual retry saves before sending',async()=>{
 let fail=true,pushes=0;const store={async save(){if(fail)throw Error('Quota')}}
 const sync=new SyncService(memoryStorage(),'x',{async pull(){return {revision:0,cells:{}}},async push(){pushes++;return {conflict:false,snapshot:{revision:1,cells:{}}}}},store)
 sync.setOnline(false);sync.enqueue('favorite',{}, {'favorite/b:0':true});sync.offline=false;await sync.flush();assert.equal(pushes,0);assert.notEqual(sync.status,'Synced')
 fail=false;await sync.flush();assert.equal(pushes,1);sync.dispose()
})
test('true conflicts block dependent work without relabeling it as a conflict',async()=>{
 const sync=new SyncService(memoryStorage(),'x',{async pull(){return {revision:0,cells:{}}},async push(){return {conflict:true,snapshot:{revision:0,cells:{}},message:'Different session'}}})
 sync.setOnline(false);sync.enqueue('submit',{}, {'session-record/a':1});sync.enqueue('assess',projection(sync.cache),{'session-record/a':2});sync.offline=false;await sync.flush()
 assert.equal(sync.counts.conflicts,1);assert.equal(sync.counts.blocked,1);assert.equal(sync.cache.queue[1].status,'pending');sync.dispose()
})
test('error categories distinguish transient, authentication, validation and actual conflicts',()=>{
 for(const [error,expected] of [[Error('Network'),'transient'],[{code:'42501'},'auth'],[{code:'23514'},'permanent'],[{code:'23505'},'permanent'],[{code:'KS409'},'conflict'],[{status:503},'transient'],[{status:429},'transient']])assert.equal(classifySyncError(error).category,expected)
})
test('118-entry legacy migration preserves events and malformed originals and is repeatable',()=>{
 const cache={...emptyCache(),version:4};for(let i=0;i<110;i++)cache.queue.push(operation(i%2?'draft':'assess',`session-record/${i}`,null,{index:i}))
 cache.queue.push(structuredClone(cache.queue[0]),structuredClone(cache.queue[1]),null,{bad:true})
 for(let i=0;i<4;i++)cache.queue.push(operation('favorite',`favorite/b:${i}`))
 assert.equal(cache.queue.length,118)
 const migrated=parseCache(JSON.stringify(cache));assert.equal(migrated.queue.length,114);assert.equal(migrated.quarantine.length,2);assert.equal(migrated.queue.filter(op=>op.kind==='assess').length,55);assert.ok(migrated.queue.every(op=>op.attempted));assert.deepEqual(parseCache(JSON.stringify(migrated)),migrated)
 const storage=memoryStorage();storage.setItem('legacy',JSON.stringify(cache));const sync=new SyncService(storage,'legacy',server());assert.equal(storage.getItem('legacy:pre-v6'),JSON.stringify(cache));sync.dispose()
})
test('interrupted processing recovers its stable payload and accepted receipts leave the queue',async()=>{
 const cache=emptyCache(),op={...operation(),status:'processing',attempted:true};op.wirePayload={id:op.id,kind:op.kind,at:op.at,changes:op.changes};cache.queue=[op]
 const storage=memoryStorage();storage.setItem('x',JSON.stringify(cache));let pushes=0
 const sync=new SyncService(storage,'x',{async reconcile(ids){assert.deepEqual(ids,[op.id]);return {accepted:ids,snapshot:{revision:1,cells:{'favorite/b:0':true}}}},async pull(){return {revision:1,cells:{'favorite/b:0':true}}},async push(){pushes++;throw Error('Must not send')}})
 assert.equal(sync.cache.queue[0].status,'pending');assert.deepEqual(sync.cache.queue[0].wirePayload,op.wirePayload);await sync.flush();assert.equal(pushes,0);assert.equal(sync.status,'Synced');sync.dispose()
})
test('status-only notifications do not rebuild or persist the account projection',async()=>{
 const app=new Application(memoryStorage(),{project:'perf-test',transport:server()});await app.setUser({id:'perf-user'});app.chooseAccount();const before=app.current,version=app.sync.dataVersion
 app.sync.setOnline(false);assert.equal(app.current,before);assert.equal(app.sync.dataVersion,version);app.sync.dispose()
})
test('guest domain writes preserve recovery without serializing unrelated vocabulary',()=>{
 const storage=memoryStorage(),data=decodeData({},emptyIdentities());saveLocal(storage,data);const keys=[];const spy={getItem:storage.getItem,setItem(key,value){keys.push(key);storage.setItem(key,value)}}
 saveLocal(spy,{...data,favorites:[0]},data);assert.ok(!keys.includes('kelime-user-vocabulary'));assert.ok(!keys.includes('kelime-learning-state'));recoverLocal(storage);assert.deepEqual(loadLocal(storage).data.favorites,[0])
})
test('state coalescing crosses unrelated state fields, but never a history event',()=>{
 const sync=new SyncService(memoryStorage(),'x',server());sync.setOnline(false)
 const first=sync.enqueue('favorite',{}, {'favorite/b:0':true})
 sync.enqueue('preferences',projection(sync.cache),{...projection(sync.cache),'setting/goal':15})
 const merged=sync.enqueue('favorite',projection(sync.cache),{...projection(sync.cache),'favorite/b:0':false})
 assert.equal(merged,first);assert.equal(sync.cache.queue.length,2)
 sync.enqueue('assess',projection(sync.cache),{...projection(sync.cache),'session-record/test':{index:1}})
 sync.enqueue('favorite',projection(sync.cache),{...projection(sync.cache),'favorite/b:0':true})
 assert.equal(sync.cache.queue.length,4);sync.dispose()
})
test('queue migration coalesces explicitly unsent state, preserves unknown attempts and reclassifies old validation errors',()=>{
 const a={...operation(),attempted:false},b={...operation('favorite','favorite/b:0',true,false),attempted:false}
 const invalid={...operation(),status:'conflict',message:'Automatic pronunciation must be a boolean'}
 const cache={...emptyCache(),queue:[a,b,invalid]};let restored=parseCache(JSON.stringify(cache))
 assert.equal(restored.queue.length,2);assert.equal(restored.queue[0].id,a.id);assert.equal(restored.queue[1].status,'failed')
 delete a.attempted;delete b.attempted;restored=parseCache(JSON.stringify(cache));assert.equal(restored.queue.length,3)
})
test('authentication failure pauses uploads until authorization is restored',async()=>{
 let fail=true,pushes=0;const remote=server(),sync=new SyncService(memoryStorage(),'x',{pull:remote.pull,async push(op){pushes++;if(fail)throw {code:'42501',message:'Expired session'};return remote.push(op)}})
 sync.setOnline(false);sync.enqueue('favorite',{}, {'favorite/b:0':true});sync.offline=false;await sync.flush();assert.equal(sync.authorized,false)
 await sync.flush();assert.equal(pushes,1);fail=false;sync.resumeAuthorization();await sync.flush(false);assert.equal(pushes,2);assert.equal(sync.status,'Synced');sync.dispose()
})
test('mutations enqueued during an in-flight pass are sent once in the next controlled pass',async()=>{
 let release;const gate=new Promise(resolve=>release=resolve),remote=server();let first=true
 const sync=new SyncService(memoryStorage(),'x',{pull:remote.pull,async push(op){if(first){first=false;await gate}return remote.push(op)}})
 sync.setOnline(false);sync.enqueue('favorite',{}, {'favorite/b:0':true});sync.offline=false;const running=sync.flush()
 while(!sync.cache.queue[0].attempted)await Promise.resolve()
 sync.enqueue('favorite',projection(sync.cache),{'favorite/b:0':false});release();await running;await sync.flush()
 assert.equal(remote.sent.length,2);assert.equal((await remote.pull()).cells['favorite/b:0'],false);assert.equal(sync.cache.queue.length,0);sync.dispose()
})
test('manual Retry recovers a failed first snapshot without recreating the processor',async()=>{
 let fail=true
 const app=new Application(memoryStorage(),{project:'initial-retry',transport:{async pull(){if(fail)throw {code:'KS422',message:'Temporary configuration problem'};return {revision:0,cells:{}}},async push(){throw Error('No queued operations')}}})
 await app.setUser({id:'initial-user'});const sync=app.sync;assert.equal(sync.cache.initialized,false)
 fail=false;await app.retry();assert.equal(app.sync,sync);assert.equal(sync.cache.initialized,true);assert.equal(app.status,'Synced');sync.dispose()
})
test('legacy draft text survives receipt reconciliation after an old lost-response mutation',async()=>{
 const storage=memoryStorage(),key=cacheKey('project','user'),cache=emptyCache(),draft={...operation('draft','session-record/session',null,{source:'daily',practice:{syncId:'session',index:0,phase:'answering',draft:'latest text'}}),attempted:true}
 cache.queue=[draft];storage.setItem(key,JSON.stringify(cache))
 const sync=new SyncService(storage,key,{async reconcile(){return {accepted:[draft.id],snapshot:{revision:1,cells:{}}}},async pull(){return {revision:1,cells:{}}},async push(){throw Error('Already accepted')}})
 assert.equal(storage.getItem('kelime-draft:project:user:daily:session:0'),'latest text');await sync.flush();assert.equal(sync.cache.queue.length,0);assert.equal(sync.cache.backups[0].id,draft.id);sync.dispose()
})
