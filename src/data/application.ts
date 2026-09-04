import type { AppData, Cells, OperationKind, CloudTransport } from './models.ts'
import { newId,equal } from './models.ts'
import { decodeData,encodeData,emptyIdentities } from './codec.ts'
import { loadLocal,recoverLocal,saveLocal,vocabularyRepository } from './localRepository.ts'
import type { StorageAccess } from './localRepository.ts'
import { SyncService,cacheKey,projection } from './syncService.ts'
import { prepareMigration,meaningfulLocal,duplicateCandidates } from './migration.ts'
import type { MigrationLinks } from './migration.ts'
import { configuration } from './supabaseClient.ts'
import { cloudRepository } from './cloudRepository.ts'
import { authService } from './authService.ts'
import type { AccountUser } from './authService.ts'
import type { ImportRow } from '../vocabularyImport.ts'
import type { WordEntry } from '../wordFields.ts'
import type { LearningState } from '../learningState.ts'

export class Application {
  version=0
  user:AccountUser|null=null
  scope='guest'
  error=''
  storageError=false
  sync:SyncService|null=null
  migrationOpen=false
  previewOpen=false
  choices:Record<string,'device'|'account'>={}
  links:MigrationLinks={}
  private guest:AppData
  private data:AppData
  private storage:StorageAccess
  private listeners=new Set<()=>void>()
  private token=0
  private previewRevision=-1
  private project: string | undefined
  private transport: CloudTransport | undefined
  private stopSync:(()=>void)|undefined
  constructor(storage:StorageAccess, options: {project?: string; transport?: CloudTransport} = {}) {
    this.project=options.project??configuration?.url
    this.transport=options.transport
    this.storage=storage
    this.guest=decodeData({},emptyIdentities())
    try {recoverLocal(storage);const loaded=loadLocal(storage);this.guest=loaded.data;this.storageError=loaded.error;this.identifySessions(this.guest);saveLocal(storage,this.guest)}catch{this.storageError=true}
    this.data=this.guest
  }
  private identifySessions(data:AppData) {
    for(const s of [data.learning.session,data.learning.reviewSession?.practice])if(s&&!s.syncId){s.syncId=newId();s.startedAt??=null;s.completedAt??=null}
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  getSnapshot=()=>this.version
  private emit(){this.version++;for(const listener of this.listeners)listener()}
  get current(){return this.data}
  get configured(){return !!this.project}
  get status(){return this.scope==='guest'?'Local only':this.sync?.status??'Sync error'}
  get candidates(){return this.sync?duplicateCandidates(this.guest,this.sync.cache.base.cells):[]}
  get preview(){return this.sync?prepareMigration(this.guest,this.sync.cache.base.cells,this.sync.cache.migrationIdentities??=emptyIdentities(),this.links,this.choices):null}
  private refresh=()=>{
    if(this.scope!=='guest'&&this.sync){try{this.data=decodeData(projection(this.sync.cache),this.sync.cache.identities);this.sync.persist(false)}catch(e){this.error=String(e)}}
    this.emit()
  }
  async setUser(user:AccountUser|null) {
    if(user?.id===this.user?.id&&this.sync)return
    const token=++this.token
    this.stopSync?.();this.sync?.dispose();this.sync=null;this.user=user;this.scope='guest';this.data=this.guest;this.migrationOpen=false;this.previewOpen=false;this.error='';this.emit()
    if(!user||!this.project)return
    try {
      const sync=new SyncService(this.storage,cacheKey(this.project,user.id),this.transport??cloudRepository(user.id))
      this.sync=sync;this.stopSync=sync.subscribe(this.refresh)
      if(sync.cache.initialized&&sync.cache.migrationChoice){this.scope=user.id;this.refresh()}
      await sync.initialize();if(token!==this.token)return
      if(sync.cache.migrationChoice||sync.cache.queue.some(op=>op.kind==='migration'&&op.status==='pending')){this.scope=user.id;sync.schedule()}
      else if(meaningfulLocal(this.guest))this.migrationOpen=true
      else {sync.cache.migrationChoice='account';this.scope=user.id;sync.persist()}
      if(this.scope!=='guest')sync.setOnline(navigator.onLine);this.refresh()
    } catch(e){if(token===this.token){this.error=e instanceof Error?e.message:'Account data could not be loaded.';this.emit()}}
  }
  async retry(){if(this.sync?.cache.initialized){if(this.scope==='guest')await this.sync.initialize();else await this.sync.flush();this.refresh()}else{const user=this.user;this.user=null;await this.setUser(user)}}
  beginMigration(){if(!this.sync?.cache.initialized){void this.retry();return}this.migrationOpen=true;this.previewOpen=false;this.emit()}
  chooseAccount(){if(!this.user||!this.sync?.cache.initialized)return;this.sync.cache.migrationChoice='account';this.scope=this.user.id;this.migrationOpen=false;this.previewOpen=false;this.sync.persist();this.sync.setOnline(navigator.onLine);this.refresh()}
  cancelMigration(){this.migrationOpen=false;this.previewOpen=false;this.scope='guest';this.data=this.guest;this.emit()}
  previewMigration(){
    try {
      let dataset=this.storage.getItem('kelime-device-dataset-id');if(!dataset){dataset=newId();this.storage.setItem('kelime-device-dataset-id',dataset)}
      this.storage.setItem(`kelime-migration-backup:${dataset}:${Date.now()}`,JSON.stringify({version:1,data:this.guest}))
      this.previewRevision=this.sync!.cache.base.revision;this.choices={};this.links={};this.previewOpen=true;this.error='';this.emit()
    }catch{this.error='A device backup could not be saved. Free browser storage before importing; your data has not been uploaded.';this.emit()}
  }
  chooseConflict(key:string,value:'device'|'account'){this.choices={...this.choices,[key]:value};this.emit()}
  chooseLink(id:number,target:string){this.links={...this.links,[id]:target};this.emit()}
  commitMigration(){
    if(!this.sync||!this.user)return
    if(this.candidates.some(c=>!this.links[c.word.id]))throw Error('Resolve the possible duplicate words first.')
    if(this.previewRevision!==this.sync.cache.base.revision){this.choices={};this.previewRevision=this.sync.cache.base.revision;this.emit();throw Error('Account data changed. Review the refreshed conflicts before confirming.')}
    const preview=this.preview!
    if(preview.conflicts.length)throw Error('Choose device or account values for every conflict.')
    const dataset=this.storage.getItem('kelime-device-dataset-id')
    if(!dataset)throw Error('Create a migration backup first.')
    this.sync.persist()
    if(this.sync.storageError)throw Error('The identity map could not be saved. Retry after freeing browser storage.')
    this.sync.enqueue('migration',this.sync.cache.base.cells,preview.cells,{expectedRevision:this.sync.cache.base.revision,migrationId:dataset})
    this.scope=this.user.id;this.migrationOpen=false;this.previewOpen=false;this.refresh()
  }
  private commit(next:AppData,kind:OperationKind) {
    this.identifySessions(next)
    if(this.scope==='guest'){this.guest=next;this.data=next;try{saveLocal(this.storage,next);this.storageError=false}catch{this.storageError=true}this.emit();return}
    const sync=this.sync!
    const before=encodeData(this.data,sync.cache.identities),after=encodeData(next,sync.cache.identities)
    // Tombstones and reads used for deletion are checked in the server transaction too.
    sync.enqueue(kind,before,after);this.data=next;this.emit()
  }
  saveLearning(next:LearningState,kind?:OperationKind) {
    const old=this.data.learning
    if(equal(old,next))return
    let action=kind
    if(!action){
      const a=old.session,b=next.session,c=old.reviewSession?.practice,d=next.reviewSession?.practice
      action=(b&&b.results.length>(a?.results.length??0)||d&&d.results.length>(c?.results.length??0))?'assess':(b?.syncId!==a?.syncId||d?.syncId!==c?.syncId)?'start':(a?.phase!==b?.phase||c?.phase!==d?.phase)?'submit':(a?.draft!==b?.draft||c?.draft!==d?.draft)?'draft':equal(old.history,next.history)?'preferences':'learned'
    }
    this.commit({...this.data,learning:next},action)
  }
  saveFavorites(favorites:number[]){this.commit({...this.data,favorites},'favorite')}
  importWords(rows:ImportRow[]){const result=vocabularyRepository.import(this.data,rows);if(result.added||result.updated)this.commit(result.data,'vocabulary');return result}
  editWord(id:number,entry:WordEntry,separate:boolean){this.commit(vocabularyRepository.edit(this.data,id,entry,separate),'vocabulary')}
  deleteWord(id:number){this.commit(vocabularyRepository.delete(this.data,id),'delete')}
  exportConflict(id:string):string {const op=this.sync?.cache.backups.find(p=>p.id===id)??this.sync?.cache.queue.find(p=>p.id===id);return JSON.stringify(op,null,2)}
  accountCells():Cells{return this.sync?.cache.base.cells??{}}
}
let instance:Application|undefined
export function application(){if(!instance)instance=new Application(localStorage);return instance}
export function connectApplication(app:Application){
  let observed=false
  const unsubscribe=authService.subscribe(user=>{observed=true;queueMicrotask(()=>{void app.setUser(user)})})
  void authService.current().then(user=>{if(!observed)void app.setUser(user)}).catch(()=>{})
  const refresh=()=>{if(document.visibilityState==='visible')void app.retry()}
  const online=()=>{if(app.scope!=='guest')app.sync?.setOnline(navigator.onLine)}
  window.addEventListener('focus',refresh);window.addEventListener('online',online);window.addEventListener('offline',online)
  const timer=setInterval(refresh,30000)
  return()=>{unsubscribe();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',online);window.removeEventListener('offline',online)}
}
