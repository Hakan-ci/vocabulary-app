import {decodeData,encodeData} from '../src/data/codec.ts'
import {createSession} from '../src/dailyTestModel.ts'
import 'fake-indexeddb/auto'
import test from 'node:test'
import assert from 'node:assert/strict'
import {IndexedAccountStore} from '../src/data/accountStore.ts'
import {emptyCache,SyncService,cacheKey,projection} from '../src/data/syncService.ts'
import {memoryStorage} from '../src/data/localRepository.ts'
import {Application} from '../src/data/application.ts'
const key=cacheKey('https://offline.example','10000000-0000-4000-8000-000000000009')
test('IndexedDB migration commits queue and projection atomically, retains backups, and never reimports legacy data',async()=>{
 const local=memoryStorage(),store=new IndexedAccountStore(crypto.randomUUID()),cache=emptyCache()
 cache.version=1;cache.queue=[{id:crypto.randomUUID(),kind:'favorite',at:1,status:'pending',changes:[{key:'favorite/b:1',before:null,after:true}]}];cache.backups=[{...cache.queue[0],status:'conflict'}]
 local.setItem(key,JSON.stringify(cache));const imported=await store.load(key,local)
 assert.equal(imported.version,2);assert.equal(imported.queue[0].id,cache.queue[0].id);assert.deepEqual(imported.backups,cache.backups)
 imported.initialized=true;await store.save(key,imported)
 local.setItem(key,JSON.stringify(emptyCache()));assert.deepEqual(await store.load(key,local),imported)
 const corrupt={...imported,queue:[{...imported.queue[0],changes:[],circular:null}]};corrupt.queue[0].circular=corrupt
 await assert.rejects(()=>store.save(key,corrupt));assert.deepEqual(await store.load(key,local),imported)
 await store.close()
})
test('offline queued actions survive reload; expired authentication prevents uploads; failed writes remain in memory',async()=>{
 const local=memoryStorage(),store=new IndexedAccountStore(crypto.randomUUID());let pushes=0
 const transport={pull:async()=>({revision:0,cells:{}}),push:async _op=>{pushes++;return {conflict:false,snapshot:{revision:1,cells:{'favorite/b:1':true}}}}}
 const initial=await store.load(key,local),sync=new SyncService(local,key,transport,store,initial)
 sync.offline=true;sync.enqueue('favorite',{}, {'favorite/b:1':true});assert.equal(await sync.whenDurable(),true);sync.dispose()
 const restored=await store.load(key,local);assert.equal(restored.queue.length,1);assert.equal(projection(restored)['favorite/b:1'],true)
 const next=new SyncService(local,key,transport,store,restored);next.authorized=false;await next.flush();assert.equal(pushes,0)
 next.authorized=true;await next.flush();assert.equal(pushes,1);assert.equal(next.cache.queue.length,0);await next.whenDurable();next.dispose()
 const broken=new SyncService(local,'broken',transport,{load:async()=>emptyCache(),save:async()=>{throw Error('disk full')}},emptyCache());broken.offline=true;broken.enqueue('favorite',{}, {'favorite/b:2':true});assert.equal(await broken.whenDurable(),false);assert.equal(projection(broken.cache)['favorite/b:2'],true);broken.dispose();await store.close()
})
test('acknowledged account restores without auth/network and explicit logout returns to isolated guest data',async()=>{
 const local=memoryStorage(),store=new IndexedAccountStore(crypto.randomUUID()),user={id:'10000000-0000-4000-8000-000000000009',email:'offline@example.com'},project='https://offline.example'
 const cache=emptyCache();cache.initialized=true;cache.migrationChoice='account';cache.base.cells={'favorite/b:4':true};await store.save(key,cache)
 local.setItem('kelime-favorites','[1]');local.setItem('kelime-last-account:'+project,JSON.stringify(user))
 const auth={current:async()=>null,subscribe:()=>()=>{},signIn:async()=>{},signUp:async()=>{},signOut:async()=>{throw Error('offline')}}
 const app=new Application(local,{project,store,auth,transport:{pull:async()=>{throw Error('must not pull')},push:async()=>{throw Error('must not push')}}});app.online=false
 await app.restoreAccount();assert.equal(app.scope,user.id);assert.equal(app.authenticated,false);assert.deepEqual(app.current.favorites,[4])
 app.saveFavorites([4,5]);await app.ensureSaved();await app.auth.signOut();assert.equal(app.scope,'guest');assert.deepEqual(app.current.favorites,[1]);await app.restoreAccount();assert.equal(app.scope,'guest')
 const saved=await store.load(key,local);assert.equal(saved.queue.length,1);assert.equal(projection(saved)['favorite/b:5'],true);await store.close()
})

test('an interrupted migration leaves the original cache recoverable and no success receipt',async()=>{
 const local=memoryStorage(),name=crypto.randomUUID(),cache=emptyCache();cache.initialized=true;local.setItem(key,JSON.stringify(cache))
 class Interrupted extends IndexedAccountStore{async save(){throw Error('interrupted')}}
 const bad=new Interrupted(name);await assert.rejects(()=>bad.load(key,local),/interrupted/);assert.equal(local.getItem(key),JSON.stringify(cache));await bad.close()
 const retry=new IndexedAccountStore(name);assert.deepEqual(await retry.load(key,local),cache);await retry.close()
})

test('local session selection cannot turn a Favorite into an unrelated session mutation',async()=>{
 const local=memoryStorage(),store=new IndexedAccountStore(crypto.randomUUID()),user={id:'10000000-0000-4000-8000-000000000009',email:'offline@example.com'},project='https://offline.example'
 const cache=emptyCache(),data=decodeData({},cache.identities,1700000000000),a=createSession(data.learning.history),b=createSession(data.learning.history)
 data.learning.session=b;data.learning.sessions={[a.syncId]:{source:'daily',practice:a},[b.syncId]:{source:'daily',practice:b}}
 cache.initialized=true;cache.migrationChoice='account';cache.base.cells=encodeData(data,cache.identities);await store.save(key,cache);local.setItem('kelime-last-account:'+project,JSON.stringify(user))
 const app=new Application(local,{project,store});app.online=false;await app.restoreAccount();app.selectSession('daily',a.syncId);app.saveFavorites([3])
 assert.equal(app.sync.cache.queue[0].changes.some(c=>c.key.startsWith('session/')),false)
 app.saveLearning({...app.current.learning,session:{...app.current.learning.session,draft:'saved'}})
 const draft=app.sync.cache.queue.at(-1);assert.equal(draft.kind,'draft');assert.equal(draft.changes.filter(c=>c.key.startsWith('session/')).length,1)
 assert.ok(draft.changes.some(c=>c.key==='session-record/'+a.syncId));await app.ensureSaved();await app.setUser(null);await store.close()
})
