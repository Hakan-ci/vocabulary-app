import {projectOperation} from './eventProjection.ts'
import type { AccountStore } from './accountStore.ts'
import type { Cells, Change, CloudTransport, Operation, OperationKind, SyncCache } from './models.ts'
import { equal,newId } from './models.ts'
import { emptyIdentities } from './codec.ts'
import type { StorageAccess } from './localRepository.ts'
export const cacheKey = (project: string,user: string)=>`kelime-account:${encodeURIComponent(project)}:${user}:v1`
export const emptyCache = (): SyncCache=>({version:2,identities:emptyIdentities(),base:{revision:0,cells:{}},queue:[],backups:[],initialized:false})
export function diffCells(before: Cells,after: Cells): Change[] { return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!equal(before[key],after[key])).map(key=>({key,before:before[key]??null,after:after[key]??null})) }
export function applyChanges(cells: Cells,changes: Change[]): Cells { const next={...cells};for(const change of changes){if(change.after===null)delete next[change.key];else next[change.key]=change.after}return next }
export function projection(cache: SyncCache): Cells { return cache.queue.filter(op=>op.status==='pending').reduce((cells,op)=>projectOperation(cells,op),cache.base.cells) }
export function parseCache(raw: string|null): SyncCache {
  if(!raw)return emptyCache()
  const value=JSON.parse(raw) as SyncCache
  if(![1,2].includes(value.version)||!value.base?.cells||!Number.isInteger(value.base.revision)||!value.identities?.localToCloud||!Number.isSafeInteger(value.identities.nextId)||!Array.isArray(value.queue)||!Array.isArray(value.backups))throw Error('Account cache could not be read. Your saved copy has not been overwritten.')
  if(value.queue.some(op=>!op.id||!Array.isArray(op.changes)||!['pending','conflict'].includes(op.status)))throw Error('Pending sync actions could not be read. Your saved copy has not been overwritten.')
  const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  for(const map of [value.identities,value.migrationIdentities].filter(Boolean)) {
    const pairs=Object.entries(map!.localToCloud)
    if(map!.nextId<1_000_000||pairs.some(([id,ref])=>!Number.isSafeInteger(Number(id))||Number(id)<1_000_000||Number(id)>=map!.nextId||!uuid(ref))||new Set(pairs.map(([,ref])=>ref)).size!==pairs.length)throw Error('Account identities could not be read. The saved copy is preserved.')
  }
  if(Array.isArray(value.base.cells)||value.base.revision<0||typeof value.initialized!=='boolean'||value.migrationChoice!==undefined&&!['account','imported'].includes(value.migrationChoice)||value.queue.some(op=>!uuid(op.id)||!['vocabulary','delete','favorite','learned','preferences','start','draft','submit','assess','migration','archive'].includes(op.kind)||op.changes.some(c=>typeof c.key!=='string'||!('before'in c)||!('after'in c))))throw Error('Invalid account cache. The saved copy is preserved.')
  return {...value,version:2}
}
export class SyncService {
  cache: SyncCache
  error=''
  storageError=false
  syncing=false
  offline=false
  authorized=true
  private running=false
  private disposed=false
  private timer: ReturnType<typeof setTimeout>|undefined
  private retryMs=1000
  private listeners=new Set<()=>void>()
  constructor(privateStorage: StorageAccess,key: string,transport: CloudTransport, durable?: AccountStore, initial?: SyncCache) {
    this.storage=privateStorage;this.key=key;this.transport=transport;this.durable=durable;this.cache=initial??parseCache(this.storage.getItem(key))
  }
  private durable:AccountStore|undefined
  private writes:Promise<void>=Promise.resolve()
  async whenDurable(){await this.writes;return !this.storageError}
  private storage: StorageAccess
  private key: string
  private transport: CloudTransport
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private emit(){for(const listener of this.listeners)listener()}
  persist(notify=true){
    if(this.durable){const copy=structuredClone(this.cache);this.writes=this.writes.then(()=>this.durable!.save(this.key,copy)).then(()=>{this.storageError=false},()=>{this.storageError=true}).then(()=>{if(notify)this.emit()})}
    else {try{this.storage.setItem(this.key,JSON.stringify(this.cache));this.storageError=false}catch{this.storageError=true}}
    if(notify)this.emit()
  }
  async initialize(){const snapshot=await this.transport.pull();if(this.disposed)return;this.cache.base=snapshot;this.cache.initialized=true;this.persist()}
  enqueue(kind: OperationKind,before: Cells,after: Cells,options: Partial<Pick<Operation,'expectedRevision'|'migrationId'>>={}) {
    const changes=diffCells(before,after)
    if(!changes.length&&kind!=='migration')return
    // Only squash unsent drafts; keep an in-flight request immutable for idempotent retries.
    const last=this.cache.queue.at(-1)
    if(kind==='draft'&&!this.running&&last?.kind==='draft'&&last.status==='pending'&&equal(last.changes.map(c=>c.key),changes.map(c=>c.key))) {
      last.changes=changes.map(c=>({...c,before:last.changes.find(old=>old.key===c.key)!.before}));last.at=Date.now()
    } else this.cache.queue.push({id:newId(),protocol:2,kind,at:Date.now(),changes,status:'pending',...options})
    this.persist();this.schedule(kind==='draft'?500:0)
  }
  schedule(ms=0){if(this.disposed)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush()},ms)}
  setOnline(online: boolean){this.offline=!online;this.emit();if(online)this.schedule()}
  async flush() {
    if(this.running||this.disposed||this.offline||!this.authorized)return
    this.running=true;this.syncing=true;this.emit()
    try {
      const blocked=new Set<string>()
      const dependencies=(op:Operation)=>op.changes.filter(c=>!['assess','submit','draft','start','archive'].includes(op.kind)||c.key.startsWith('session-record/')||!op.changes.some(c=>c.key.startsWith('session-record/'))&&c.key.startsWith('session/'))
      for(const op of this.cache.queue) {
        if(this.disposed)break
        if(op.status==='conflict'){dependencies(op).forEach(c=>blocked.add(c.key));continue}
        if(dependencies(op).some(c=>blocked.has(c.key))){op.status='conflict';op.message='This action depends on an unresolved action.';dependencies(op).forEach(c=>blocked.add(c.key));continue}
        await this.whenDurable()
        if(this.disposed||!this.authorized||this.offline)break
        const result=await this.transport.push(op)
        if(this.disposed)break
        this.cache.base=result.snapshot
        if(result.conflict){op.status='conflict';op.message=result.message??'Account data changed on another device. Your device action is retained for review.';dependencies(op).forEach(c=>blocked.add(c.key))}
        else {this.cache.queue=this.cache.queue.filter(p=>p.id!==op.id);if(op.kind==='migration')this.cache.migrationChoice='imported'}
        this.persist()
      }
      if(!this.disposed){this.cache.base=await this.transport.pull();this.cache.initialized=true;this.error='';this.retryMs=1000;this.persist()}
    } catch(error){this.error=error instanceof Error?error.message:'Synchronization failed.';this.schedule(this.retryMs);this.retryMs=Math.min(60000,this.retryMs*2)}
    finally {this.running=false;this.syncing=false;this.emit();if(!this.error&&this.cache.queue.some(op=>op.status==='pending'))this.schedule()}
  }
  resolve(id: string,choice: 'account'|'device') {
    const op=this.cache.queue.find(p=>p.id===id);if(!op)return
    if(choice==='device'&&['assess','submit','start','draft','migration','delete','archive'].includes(op.kind))throw Error('Keep the account session and restart or retry this action from current data. The original device action is preserved below.')
    this.cache.backups.push(structuredClone(op));this.cache.queue=this.cache.queue.filter(p=>p.id!==id)
    if(choice==='device')this.cache.queue.push({...op,id:newId(),status:'pending',changes:op.changes.map(c=>({...c,before:this.cache.base.cells[c.key]??null}))})
    this.persist();this.schedule()
  }
  dispose(){this.disposed=true;clearTimeout(this.timer);this.listeners.clear()}
  get status(){return this.offline?'Offline':this.syncing?'Syncing…':this.error||this.cache.queue.some(op=>op.status==='conflict')?'Sync error':this.cache.queue.length?'Changes waiting':'Synced'}
}
