import {projectOperation} from './eventProjection.ts'
import type {AccountStore} from './accountStore.ts'
import type {Cells,Change,CloudTransport,Operation,OperationKind,SyncCache} from './models.ts'
import {equal,newId,json} from './models.ts'
import {emptyIdentities} from './codec.ts'
import type {StorageAccess} from './localRepository.ts'
import {migrateQueue,coalesceTail} from './queueMigration.ts'
import {classifySyncError} from './syncErrors.ts'
export const cacheKey=(project:string,user:string)=>`kelime-account:${encodeURIComponent(project)}:${user}:v1`
export const emptyCache=():SyncCache=>({version:5,identities:emptyIdentities(),base:{revision:0,cells:{}},queue:[],backups:[],initialized:false})
export function diffCells(before:Cells,after:Cells):Change[]{return [...new Set([...Object.keys(before),...Object.keys(after)])].filter(key=>!equal(before[key],after[key])).map(key=>({key,before:before[key]??null,after:after[key]??null}))}
export function applyChanges(cells:Cells,changes:Change[]):Cells{const next={...cells};for(const c of changes){if(c.after===null)delete next[c.key];else next[c.key]=c.after}return next}
export function projection(cache:SyncCache):Cells{return cache.queue.filter(op=>op.status!=='conflict'&&!op.blockedBy).reduce((cells,op)=>projectOperation(cells,op),cache.base.cells)}
export function parseCache(raw:string|null):SyncCache{
  if(!raw)return emptyCache()
  const value=JSON.parse(raw) as SyncCache
  if(![1,2,3,4,5].includes(value.version)||!value.base?.cells||typeof value.base.cells!=='object'||Array.isArray(value.base.cells)||!Number.isSafeInteger(value.base.revision)||value.base.revision<0||!value.identities?.localToCloud||!Array.isArray(value.queue)||!Array.isArray(value.backups)||typeof value.initialized!=='boolean'||value.migrationChoice!==undefined&&!['account','imported'].includes(value.migrationChoice))throw Error('Account cache could not be read. Your saved copy has not been overwritten.')
  const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  for(const map of [value.identities,value.migrationIdentities].filter(Boolean)){
    const pairs=Object.entries(map!.localToCloud)
    if(!Number.isSafeInteger(map!.nextId)||map!.nextId<1_000_000||pairs.some(([id,ref])=>!Number.isSafeInteger(Number(id))||Number(id)<1_000_000||Number(id)>=map!.nextId||!uuid(ref))||new Set(pairs.map(([,ref])=>ref)).size!==pairs.length)throw Error('Account identities could not be read. The saved copy is preserved.')
  }
  return migrateQueue(value)
}
const dependencies=(op:Operation)=>op.changes.filter(c=>!['assess','submit','draft','start','archive'].includes(op.kind)||c.key.startsWith('session-record/')||!op.changes.some(c=>c.key.startsWith('session-record/'))&&c.key.startsWith('session/')).map(c=>c.key)
export class SyncService{
  cache:SyncCache
  error=''
  storageError=false
  syncing=false
  offline=false
  authorized=true
  dataVersion=0
  private running=false
  private disposed=false
  private inFlightId:string|undefined
  private batchIds:string[]=[]
  private timer:ReturnType<typeof setTimeout>|undefined
  private retryAt=0
  private failures=0
  private paused=false
  private writes:Promise<void>=Promise.resolve()
  private listeners=new Set<()=>void>()
  private storage:StorageAccess
  private key:string
  private transport:CloudTransport
  private durable:AccountStore|undefined
  constructor(storage:StorageAccess,key:string,transport:CloudTransport,durable?:AccountStore,initial?:SyncCache){
    this.storage=storage;this.key=key;this.transport=transport;this.durable=durable
    const raw=initial?null:storage.getItem(key)
    this.cache=initial??parseCache(raw)
    this.retryAt=Math.max(0,...this.cache.queue.map(op=>op.nextRetryAt??0))
    this.failures=Math.max(0,...this.cache.queue.map(op=>op.retryCount??0))
    this.paused=this.cache.queue.some(op=>op.status==='failed')
    // Old releases could mutate a draft after losing its accepted response.
    // Preserve its latest text locally before a receipt can remove that queue ID.
    if(key.startsWith('kelime-account:')){
      const scope=key.slice('kelime-account:'.length).replace(/:v1$/,''),drafts=new Map<string,string>()
      for(const op of this.cache.queue)if(op.kind==='draft')for(const change of op.changes){
        if(!change.key.startsWith('session-record/'))continue
        const record=change.after as unknown as {source?:string;practice?:{syncId?:string;index?:number;phase?:string;draft?:string}}|null,practice=record?.practice
        if(['daily','review'].includes(record?.source??'')&&practice?.syncId&&Number.isSafeInteger(practice.index)&&practice.phase==='answering'&&typeof practice.draft==='string')drafts.set(`kelime-draft:${scope}:${record!.source}:${practice.syncId}:${practice.index}`,practice.draft)
      }
      for(const [draftKey,text] of drafts)try{if(storage.getItem(draftKey)===null)storage.setItem(draftKey,text)}catch{this.storageError=true}
    }
    if(raw&&JSON.parse(raw).version!==5){storage.setItem(key+':pre-v5',raw);this.persist(false)}
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  private emit(){for(const listener of this.listeners)listener()}
  private acceptSnapshot(snapshot:SyncCache['base']){if(snapshot.revision>=this.cache.base.revision)this.cache.base=snapshot}
  persist(notify=true){
    this.dataVersion++
    if(this.durable){const copy=structuredClone(this.cache);this.writes=this.writes.then(()=>this.durable!.save(this.key,copy)).then(()=>{this.storageError=false},()=>{this.storageError=true}).then(()=>{if(notify)this.emit()})}
    else try{this.storage.setItem(this.key,JSON.stringify(this.cache));this.storageError=false}catch{this.storageError=true}
    if(notify)this.emit()
  }
  async whenDurable(){await this.writes;return !this.storageError}
  async initialize(){await this.flush(false)}
  enqueue(kind:OperationKind,before:Cells,after:Cells,options:Partial<Pick<Operation,'expectedRevision'|'migrationId'|'notBefore'|'undoLabel'>>={}){
    const changes=diffCells(before,after)
    if(!changes.length&&kind!=='migration')return undefined
    const op:Operation={id:newId(),protocol:4,kind,at:Date.now(),changes,status:'pending',attempted:false,retryCount:0,...options}
    const coalesced=coalesceTail(this.cache.queue,op)
    if(!coalesced)this.cache.queue.push(op)
    const id=coalesced??op.id
    this.persist();this.schedule(options.notBefore?Math.max(0,options.notBefore-Date.now()):kind==='draft'?500:0)
    return id
  }
  cancelPending(id:string){const op=this.cache.queue.find(p=>p.id===id);if(!op||op.status!=='pending'||op.attempted||this.inFlightId===id)return false;this.cache.queue=this.cache.queue.filter(p=>p.id!==id);this.persist();return true}
  schedule(ms=0){if(this.disposed||this.paused||this.offline||!this.authorized)return;clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.flush(false)},Math.max(ms,this.retryAt-Date.now(),0))}
  setOnline(online:boolean){this.offline=!online;this.emit();if(online)this.schedule()}
  resumeAuthorization(){this.authorized=true;if(this.cache.queue.some(op=>op.errorCategory==='auth')){this.paused=false;this.retryAt=0;this.failures=0;for(const op of this.cache.queue)if(op.errorCategory==='auth'){op.status='pending';delete op.nextRetryAt}this.persist()}this.schedule()}
  async flush(manual=true){
    if(this.running||this.disposed||this.offline||!this.authorized)return
    if(!manual&&(this.paused||Date.now()<this.retryAt)){this.schedule();return}
    if(manual){this.paused=false;this.failures=0;this.retryAt=0;for(const op of this.cache.queue)if(op.status==='failed'){op.status='pending';delete op.nextRetryAt}this.persist()}
    clearTimeout(this.timer);this.running=true;this.syncing=true;this.emit()
    try{
      if(!await this.whenDurable())throw Object.assign(Error('Offline changes could not be saved.'),{code:'STORAGE'})
      if(this.transport.reconcile&&this.cache.queue.some(op=>op.attempted)){
        const result=await this.transport.reconcile(this.cache.queue.filter(op=>op.attempted).map(op=>op.id))
        if(this.disposed)return
        for(const op of this.cache.queue)if(op.kind==='migration'&&result.accepted.includes(op.id))this.cache.migrationChoice='imported'
        for(const op of this.cache.queue)if(op.kind==='draft'&&result.accepted.includes(op.id)&&!this.cache.backups.some(p=>p.id===op.id))this.cache.backups.push(structuredClone(op))
        this.cache.queue=this.cache.queue.filter(op=>!result.accepted.includes(op.id));this.acceptSnapshot(result.snapshot);this.persist()
      }
      const blocked=new Map<string,string>()
      if(this.transport.compactDrafts){
        const chain:Operation[]=[]
        for(const op of [...this.cache.queue,{id:'',kind:'archive',at:0,changes:[],status:'pending'} as Operation]){
          const previous=chain.at(-1)
          const compatible=op.kind==='draft'&&op.status==='pending'&&!op.notBefore&&(!previous||equal(previous.changes.map(c=>c.key).sort(),op.changes.map(c=>c.key).sort())&&op.changes.every(c=>equal(c.before,previous.changes.find(p=>p.key===c.key)!.after)))
          if(!compatible){
            if(chain.length>1){
              // Retain original payloads even after successful server-side compaction.
              this.batchIds=chain.map(p=>p.id)
              for(const draft of chain){draft.attempted=true;draft.lastAttemptAt=Date.now();if(!this.cache.backups.some(p=>p.id===draft.id))this.cache.backups.push(structuredClone(draft))}
              this.persist();if(!await this.whenDurable())throw Object.assign(Error('Draft backup could not be saved.'),{code:'STORAGE'})
              if(this.disposed||this.offline||!this.authorized)return
              const result=await this.transport.compactDrafts(chain)
              if(this.disposed)return
              this.batchIds=[]
              this.acceptSnapshot(result.snapshot);this.cache.queue=this.cache.queue.filter(p=>!result.accepted.includes(p.id));this.persist()
            }
            chain.length=0
          }
          if(op.kind==='draft'&&op.status==='pending'&&!op.notBefore)chain.push(op)
        }
      }
      for(const op of [...this.cache.queue]){
        if(this.disposed||!this.authorized||this.offline)break
        if(!this.cache.queue.includes(op))continue
        delete op.blockedBy
        if(op.status==='conflict'||op.status==='failed'){dependencies(op).forEach(key=>blocked.set(key,op.id));continue}
        const dependency=dependencies(op).find(key=>blocked.has(key))
        if(dependency){op.blockedBy=blocked.get(dependency);dependencies(op).forEach(key=>blocked.set(key,op.id));continue}
        if(op.notBefore&&op.notBefore>Date.now()){dependencies(op).forEach(key=>blocked.set(key,op.id));continue}
        op.wirePayload??=json({id:op.id,protocol:op.protocol,kind:op.kind,at:op.at,changes:op.changes,...(op.expectedRevision!==undefined?{expectedRevision:op.expectedRevision}:{}),...(op.migrationId?{migrationId:op.migrationId}:{})})
        op.attempted=true;op.status='processing';op.lastAttemptAt=Date.now();this.inFlightId=op.id;this.persist()
        if(!await this.whenDurable())throw Object.assign(Error('Offline changes could not be saved.'),{code:'STORAGE'})
        if(this.disposed||!this.authorized||this.offline){op.status='pending';this.persist();break}
        const result=await this.transport.push({...op,...op.wirePayload as object})
        if(this.disposed)return
        this.inFlightId=undefined;this.acceptSnapshot(result.snapshot)
        if(result.conflict){op.status='conflict';op.errorCategory='conflict';op.message=result.message??'Account data changed. Your device action is preserved.';dependencies(op).forEach(key=>blocked.set(key,op.id))}
        else{this.cache.queue=this.cache.queue.filter(p=>p.id!==op.id);if(op.kind==='migration')this.cache.migrationChoice='imported';this.failures=0;this.retryAt=0}
        this.persist()
      }
      if(!this.disposed&&this.authorized&&!this.offline){const snapshot=await this.transport.pull();if(this.disposed)return;const changed=!equal(this.cache.base,snapshot)||!this.cache.initialized;this.acceptSnapshot(snapshot);this.cache.initialized=true;this.error='';if(changed||this.cache.queue.length)this.persist()}
    }catch(error){
      const failure=classifySyncError(error),op=this.cache.queue.find(p=>p.id===this.inFlightId)
      this.error=failure.message;this.failures++
      const delay=Math.min(60000,1000*2**(this.failures-1));this.retryAt=Date.now()+delay
      this.paused=failure.category!=='transient'||this.failures>=8
      if(failure.category==='auth')this.authorized=false
      if(op){op.status=failure.category==='conflict'?'conflict':'failed';op.errorCategory=failure.category;op.message=failure.message;op.retryCount=(op.retryCount??0)+1;op.nextRetryAt=this.retryAt;if(!this.paused)op.status='pending'}
      for(const draft of this.cache.queue.filter(p=>this.batchIds.includes(p.id))){draft.status=this.paused?'failed':'pending';draft.errorCategory=failure.category;draft.message=failure.message;draft.retryCount=(draft.retryCount??0)+1;draft.nextRetryAt=this.retryAt}
      this.persist()
      if(import.meta.env?.DEV)console.debug('Sync attempt failed',{id:op?.id,kind:op?.kind,entities:op?.changes.map(c=>c.key),retryCount:op?.retryCount,category:failure.category})
    }finally{
      this.inFlightId=undefined;this.batchIds=[];this.running=false;this.syncing=false;this.emit()
      if(this.error){if(!this.paused)this.schedule()}
      else{const pending=this.cache.queue.filter(op=>op.status==='pending'&&!op.blockedBy);const next=Math.min(...pending.map(op=>op.notBefore??Date.now()));if(Number.isFinite(next))this.schedule(Math.max(0,next-Date.now()))}
    }
  }
  resolve(id:string,choice:'account'|'device'){
    const op=this.cache.queue.find(p=>p.id===id);if(!op||op.status!=='conflict')return
    if(choice==='device'&&!['vocabulary','favorite','learned','preferences'].includes(op.kind))throw Error('Keep the account session and retry from current data. The original action is preserved.')
    this.cache.backups.push(structuredClone(op));this.cache.queue=this.cache.queue.filter(p=>p.id!==id)
    if(choice==='device')this.cache.queue.push({...op,id:newId(),status:'pending',attempted:false,wirePayload:undefined,errorCategory:undefined,message:undefined,retryCount:0,changes:op.changes.map(c=>({...c,before:this.cache.base.cells[c.key]??null}))})
    for(const successor of this.cache.queue)delete successor.blockedBy
    this.persist();this.schedule()
  }
  dispose(){this.disposed=true;clearTimeout(this.timer);this.listeners.clear()}
  get counts(){return {pending:this.cache.queue.filter(op=>op.status==='pending'||op.status==='processing').length,failed:this.cache.queue.filter(op=>op.status==='failed').length,conflicts:this.cache.queue.filter(op=>op.status==='conflict').length,blocked:this.cache.queue.filter(op=>op.blockedBy).length}}
  get status(){return this.offline?'Offline':this.syncing?'Syncing…':this.storageError||this.error||this.counts.failed||this.cache.quarantine?.length?'Sync error':this.counts.conflicts?'Conflicts need attention':this.cache.queue.length?'Changes waiting':'Synced'}
}
