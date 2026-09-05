import { accountStore } from './accountStore.ts'
import type { AccountStore } from './accountStore.ts'
import { acquireAccountLock } from './accountLock.ts'
import type { AppData, Cells, OperationKind, CloudTransport } from './models.ts'
import { newId,equal } from './models.ts'
import { decodeData,encodeData,emptyIdentities } from './codec.ts'
import { loadLocal,recoverLocal,recordDeletionJournal,saveLocal,vocabularyRepository } from './localRepository.ts'
import type { StorageAccess } from './localRepository.ts'
import { SyncService,cacheKey,projection,parseCache } from './syncService.ts'
import { prepareMigration,meaningfulLocal,duplicateCandidates } from './migration.ts'
import type { MigrationLinks } from './migration.ts'
import { configuration } from './supabaseClient.ts'
import { cloudRepository } from './cloudRepository.ts'
import { authService } from './authService.ts'
import type { AccountUser } from './authService.ts'
import type { ImportRow } from '../vocabularyImport.ts'
import type { WordEntry } from '../wordFields.ts'
import type { LearningState } from '../learningState.ts'
import { combinedCatalog } from '../userVocabulary.ts'
import { planVocabularyDeletion, vocabularyDeletionSnapshot } from '../vocabularyManagement.ts'
import type { ClearLevel, DeletionSnapshot, VocabularyDeletionPlan } from '../vocabularyManagement.ts'

const PENDING_DELETION_KEY='kelime-pending-vocabulary-deletion'
export type PendingDeletionNotice={commandId:string;deadline:number;personal:number;builtIns:number}

export class Application {
  version=0
  online=typeof navigator==='undefined'?true:navigator.onLine
  networkNotice=''
  private durable:AccountStore|undefined
  auth:typeof authService
  user:AccountUser|null=null
  authenticated=false
  private get rememberedKey(){return `kelime-last-account:${this.project??'local'}`}
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
  private releaseAccount:(()=>void)|undefined
  private token=0
  private previewRevision=-1
  private project: string | undefined
  private transport: CloudTransport | undefined
  private stopSync:(()=>void)|undefined
  private guestDeletion:DeletionSnapshot|null=null
  private undoTimer:ReturnType<typeof setTimeout>|undefined
  constructor(storage:StorageAccess, options: {project?: string; transport?: CloudTransport; auth?: typeof authService; store?: AccountStore} = {}) {
    this.durable=options.store??(typeof indexedDB!=='undefined'?accountStore:undefined)
    this.auth=options.auth??authService
    this.project=options.project??configuration?.url
    this.transport=options.transport
    this.storage=storage
    this.guest=decodeData({},emptyIdentities())
    try {recoverLocal(storage);const loaded=loadLocal(storage);this.guest=loaded.data;this.storageError=loaded.error;this.identifySessions(this.guest);saveLocal(storage,this.guest)}catch{this.storageError=true}
    this.data=this.guest
    try{const pending=JSON.parse(this.storage.getItem(PENDING_DELETION_KEY)??'null') as DeletionSnapshot|null;if(pending?.version===1&&pending.deadline&&pending.deadline>Date.now()){this.guestDeletion=pending;this.guest=pending.after;this.data=pending.after;saveLocal(this.storage,pending.after);this.armUndo(pending.deadline)}else if(pending){recordDeletionJournal(this.storage,pending.after.vocabulary,[...pending.plan.builtInIds]);this.guest=pending.after;this.data=pending.after;saveLocal(this.storage,pending.after);this.storage.setItem(PENDING_DELETION_KEY,'null')}}catch{this.storageError=true}
    const auth=this.auth
    this.auth={...auth,signIn:async(email,password)=>{await auth.signIn(email,password);this.storage.setItem(this.rememberedKey+':signed-out','false');await this.setUser(await auth.current())},signOut:async()=>{this.storage.setItem(this.rememberedKey+':signed-out','true');this.storage.setItem(this.rememberedKey,'null');await this.setUser(null);try{await auth.signOut()}catch{this.reportError('Signed out on this device. The server could not be reached.')}}}
  }
  async restoreAccount(){try{if(this.storage.getItem(this.rememberedKey+':signed-out')==='true')return;const user=JSON.parse(this.storage.getItem(this.rememberedKey)??'null');if(user?.id)await this.setUser(user,true)}catch(e){this.reportError(e)}}
  async acceptAuth(user:AccountUser|null){if(this.storage.getItem(this.rememberedKey+':signed-out')==='true')return;if(user)await this.setUser(user);else if(this.user){this.authenticated=false;if(this.sync)this.sync.authorized=false;this.emit()}}
  private remember(){if(this.scope!=='guest'&&this.user)try{this.storage.setItem(this.rememberedKey,JSON.stringify(this.user))}catch{this.storageError=true}}
  private identifySessions(data:AppData) {
    for(const s of [data.learning.session,data.learning.reviewSession?.practice])if(s&&!s.syncId){s.syncId=newId();s.startedAt??=null;s.completedAt??=null}
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  getSnapshot=()=>this.version
  reportError(error:unknown){this.error=error instanceof Error?error.message:String(error);this.emit()}
  private emit(){this.version++;for(const listener of this.listeners)listener()}
  get current(){return this.data}
  get configured(){return !!this.project}
  get status(){return !this.online?'Offline':this.scope==='guest'?'Local only':!this.authenticated?'Changes waiting':this.sync?.status??'Sync error'}
  get pendingDeletion():PendingDeletionNotice|null{
    if(this.scope==='guest'){const value=this.guestDeletion;return value?.deadline&&value.deadline>Date.now()?{commandId:value.commandId,deadline:value.deadline,personal:value.plan.personalIds.length,builtIns:value.plan.builtInIds.length}:null}
    const op=this.sync?.cache.queue.find(item=>item.kind==='bulk-delete'&&item.status==='pending'&&item.notBefore&&item.notBefore>Date.now())
    if(!op)return null
    try{const label=JSON.parse(op.undoLabel??'{}') as {personal?:number;builtIns?:number};return {commandId:op.id,deadline:op.notBefore!,personal:label.personal??0,builtIns:label.builtIns??0}}catch{return {commandId:op.id,deadline:op.notBefore!,personal:0,builtIns:0}}
  }
  private armUndo(deadline:number){clearTimeout(this.undoTimer);this.undoTimer=setTimeout(()=>{if(this.scope==='guest'&&this.guestDeletion?.deadline===deadline){try{recordDeletionJournal(this.storage,this.guestDeletion.after.vocabulary,this.guestDeletion.plan.builtInIds);this.storage.setItem(PENDING_DELETION_KEY,'null')}catch{this.storageError=true}this.guestDeletion=null}this.emit()},Math.max(0,deadline-Date.now()))}
  setOnline(online:boolean){this.online=online;this.networkNotice=online?'Back online — syncing saved progress.':'You’re offline — your progress will be saved on this device.';if(this.scope!=='guest')this.sync?.setOnline(online);this.emit()}
  reloadGuest(){if(this.scope!=='guest')return;try{const loaded=loadLocal(this.storage);this.guest=loaded.data;this.data=loaded.data;this.storageError||=loaded.error;this.emit()}catch{this.storageError=true;this.emit()}}
  async ensureSaved(){if(this.scope==='guest')return !this.storageError;return await this.sync?.whenDurable()??false}
  isProvisional(source:'daily'|'review'){return this.sync?.cache.queue.some(op=>op.kind==='assess'&&op.status==='pending'&&op.changes.some(c=>{if(c.key!=='session/'+source)return false;const value=c.after as unknown as {phase?:string;practice?:{phase:string}}|null;return (source==='daily'?value?.phase:value?.practice?.phase)==='completed'}))??false}
  get candidates(){return this.sync?duplicateCandidates(this.guest,this.sync.cache.base.cells):[]}
  get preview(){
    if(!this.sync)return null
    try{return prepareMigration(this.guest,this.sync.cache.base.cells,this.sync.cache.migrationIdentities??=emptyIdentities(),this.links,this.choices)}
    catch(e){return {cells:this.sync.cache.base.cells,additions:0,historicalAnswers:0,conflicts:[{key:'identity',label:String(e)+' Choose a separate word or another available target.',device:null,account:null}]}}
  }
  private refresh=()=>{
    if(this.scope!=='guest'&&this.sync){try{this.data=decodeData(projection(this.sync.cache),this.sync.cache.identities);this.applySelections();this.sync.persist(false)}catch(e){this.error=String(e)}}
    this.emit()
  }
  private applySelections(){for(const source of ['daily','review'] as const){const id=this.sync?.cache.selections?.[source],record=id?this.data.learning.sessions?.[id]:undefined;if(record&&!record.archivedAt){if(source==='daily')this.data.learning.session=record.practice;else this.data.learning.reviewSession={version:2,practice:record.practice}}}}
  selectSession(source:'daily'|'review',id:string){const record=this.data.learning.sessions?.[id];if(!record||record.archivedAt)return;if(this.sync&&this.scope!=='guest'){this.sync.cache.selections={...this.sync.cache.selections,[source]:id};this.sync.persist(false)}if(source==='daily')this.data.learning={...this.data.learning,session:record.practice};else this.data.learning={...this.data.learning,reviewSession:{version:2,practice:record.practice}};if(this.scope==='guest'){this.guest=this.data;try{saveLocal(this.storage,this.data)}catch{this.storageError=true}}this.emit()}
  archivePractice(source:'daily'|'review'){const state=this.data.learning,practice=source==='daily'?state.session:state.reviewSession?.practice;if(!practice?.syncId)return;const sessions={...state.sessions,[practice.syncId]:{source,practice,archivedAt:Date.now()}};this.saveLearning({...state,sessions,...(source==='daily'?{session:null}:{reviewSession:null})},'archive')}
  async setUser(user:AccountUser|null,cachedOnly=false) {
    if(user?.id===this.user?.id&&this.sync){if(!cachedOnly){this.authenticated=true;this.sync.authorized=true;this.sync.setOnline(this.online);this.remember();this.emit()}return}
    const token=++this.token
    this.stopSync?.();this.sync?.dispose();this.releaseAccount?.();this.releaseAccount=undefined;this.sync=null;this.authenticated=!cachedOnly&&!!user;this.user=user;this.scope='guest';this.data=this.guest;this.migrationOpen=false;this.previewOpen=false;this.error='';this.emit()
    if(!user||!this.project)return
    try {
      const release=await acquireAccountLock(this.project,user.id)
      if(token!==this.token){release();return}
      this.releaseAccount=release
      const key=cacheKey(this.project,user.id)
      let initial
      try{initial=await this.durable?.load(key,this.storage)}catch(e){this.reportError(e);this.storageError=true;initial=parseCache(this.storage.getItem(key));this.durable={load:async()=>initial!,save:async()=>{throw Error('Offline account storage is unavailable. Keep this window open.')}}}
      if(token!==this.token){release();return}
      const sync=new SyncService(this.storage,key,this.transport??cloudRepository(user.id),this.durable,initial)
      sync.authorized=this.authenticated;this.sync=sync;this.stopSync=sync.subscribe(this.refresh)
      if(sync.cache.initialized&&(sync.cache.migrationChoice||sync.cache.queue.some(op=>op.kind==='migration'&&op.status==='pending'))){this.scope=user.id;this.refresh()}
      sync.offline=!this.online
      if(!this.online||cachedOnly){this.refresh();return}
      await sync.initialize();if(token!==this.token)return
      if(sync.cache.migrationChoice||sync.cache.queue.some(op=>op.kind==='migration'&&op.status==='pending')){this.scope=user.id;sync.schedule()}
      else if(meaningfulLocal(this.guest))this.migrationOpen=true
      else {sync.cache.migrationChoice='account';this.scope=user.id;sync.persist()}
      if(this.scope!=='guest')sync.setOnline(navigator.onLine);this.remember();this.refresh()
    } catch(e){if(token===this.token){this.error=e instanceof Error?e.message:'Account data could not be loaded.';this.emit()}}
  }
  async retry(){if(!this.authenticated&&this.user&&this.online){await this.acceptAuth(await this.auth.current());if(!this.authenticated)return}if(this.sync?.cache.initialized){if(this.scope==='guest')await this.sync.initialize();else await this.sync.flush();this.refresh()}else{const user=this.user;this.user=null;await this.setUser(user)}}
  beginMigration(){if(!this.sync?.cache.initialized){void this.retry();return}this.migrationOpen=true;this.previewOpen=false;this.emit()}
  chooseAccount(){if(!this.user||!this.sync?.cache.initialized)return;this.sync.cache.migrationChoice='account';this.scope=this.user.id;this.migrationOpen=false;this.previewOpen=false;this.sync.persist();this.sync.setOnline(navigator.onLine);this.remember();this.refresh()}
  cancelMigration(){this.migrationOpen=false;this.previewOpen=false;this.scope='guest';this.data=this.guest;this.emit()}
  previewMigration(){
    try {
      let dataset=this.storage.getItem('kelime-device-dataset-id');if(!dataset){dataset=newId();this.storage.setItem('kelime-device-dataset-id',dataset)}
      this.storage.setItem(`kelime-migration-backup:${dataset}:${Date.now()}`,JSON.stringify({version:1,data:this.guest}))
      this.previewRevision=this.sync!.cache.base.revision;this.choices={};this.links={};this.previewOpen=true;this.error='';this.emit()
    }catch{this.error='A device backup could not be saved. Free browser storage before importing; your data has not been uploaded.';this.emit()}
  }
  chooseConflict(key:string,value:'device'|'account'){this.choices={...this.choices,[key]:value};this.emit()}
  chooseLink(id:number,target:string){if(target!=='new'&&Object.entries(this.links).some(([key,value])=>Number(key)!==id&&value===target)){this.error='Link each account word only once. Keep other entries separate.';this.emit();return}this.error='';this.links={...this.links,[id]:target};this.emit()}
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
    this.scope=this.user.id;this.migrationOpen=false;this.previewOpen=false;this.remember();this.refresh()
  }
  private commit(next:AppData,kind:OperationKind,options:Parameters<SyncService['enqueue']>[3]={}) {
    this.identifySessions(next)
    if(this.scope==='guest'){this.guest=next;this.data=next;try{saveLocal(this.storage,next);this.storageError=false}catch{this.storageError=true}this.emit();return undefined}
    const sync=this.sync!
    const before=projection(sync.cache),after=encodeData(next,sync.cache.identities)
    // Per-device selection is not a mutation of another device's current pointer.
    for(const source of ['daily','review'] as const){
      const old=source==='daily'?this.data.learning.session:this.data.learning.reviewSession
      const updated=source==='daily'?next.learning.session:next.learning.reviewSession
      if(!['start','draft','submit','assess','archive','bulk-delete','clear-user','reset-progress','clear-all'].includes(kind)||equal(old,updated)){
        const key='session/'+source;if(key in before)after[key]=before[key];else delete after[key]
      }
    }
    if(['bulk-delete','clear-user','reset-progress','clear-all'].includes(kind))sync.cache.selections={daily:next.learning.session?.syncId,review:next.learning.reviewSession?.practice.syncId}
    // Tombstones and reads used for deletion are checked in the server transaction too.
    const id=sync.enqueue(kind,before,after,options);this.data=next;this.emit();return id
  }
  saveLearning(next:LearningState,kind?:OperationKind) {
    const old=this.data.learning
    if(equal(old,next))return
    let action=kind
    if(!action){
      const a=old.session,b=next.session,c=old.reviewSession?.practice,d=next.reviewSession?.practice
      action=(b&&b.results.length>(a?.results.length??0)||d&&d.results.length>(c?.results.length??0))?'assess':(b?.syncId!==a?.syncId||d?.syncId!==c?.syncId)?'start':(a?.phase!==b?.phase||c?.phase!==d?.phase)?'submit':(a?.draft!==b?.draft||c?.draft!==d?.draft)?'draft':equal(old.history,next.history)?'preferences':'learned'
    }
    const sessions={...old.sessions,...next.sessions}
    for(const [source,practice] of [['daily',old.session],['review',old.reviewSession?.practice],['daily',next.session],['review',next.reviewSession?.practice]] as const)if(practice?.syncId&&!sessions[practice.syncId]?.archivedAt)sessions[practice.syncId]={source,practice}
    next={...next,sessions}
    if(this.sync&&this.scope!=='guest'){this.sync.cache.selections={daily:next.session?.syncId,review:next.reviewSession?.practice.syncId}}
    this.commit({...this.data,learning:next},action)
  }
  saveFavorites(favorites:number[]){this.commit({...this.data,favorites},'favorite')}
  importWords(rows:ImportRow[]){const result=vocabularyRepository.import(this.data,rows);if(result.added||result.updated)this.commit(result.data,'vocabulary');return result}
  editWord(id:number,entry:WordEntry,separate:boolean){this.commit(vocabularyRepository.edit(this.data,id,entry,separate),'vocabulary')}
  deleteWord(id:number){this.commit(vocabularyRepository.delete(this.data,id),'delete')}
  deletionPlan(ids:readonly number[]):VocabularyDeletionPlan{return planVocabularyDeletion(this.data,ids)}
  deleteWords(ids:readonly number[],now=Date.now()){
    const snapshot=vocabularyDeletionSnapshot(this.data,ids,newId(),now)
    if(!snapshot.plan.ids.length)return snapshot.plan
    if(this.scope==='guest'){
      if(snapshot.deadline){this.storage.setItem(PENDING_DELETION_KEY,JSON.stringify(snapshot));this.guestDeletion=snapshot;this.armUndo(snapshot.deadline)}else recordDeletionJournal(this.storage,snapshot.after.vocabulary,snapshot.plan.builtInIds)
      this.commit(snapshot.after,'bulk-delete')
    }else{
      const options=snapshot.deadline?{notBefore:snapshot.deadline,undoLabel:JSON.stringify({personal:snapshot.plan.personalIds.length,builtIns:snapshot.plan.builtInIds.length})}:{}
      this.commit(snapshot.after,'bulk-delete',options)
    }
    return snapshot.plan
  }
  undoVocabularyDeletion(){
    if(this.scope==='guest'){
      const pending=this.guestDeletion;if(!pending?.deadline||pending.deadline<=Date.now())return false
      this.guest=pending.before;this.data=pending.before;saveLocal(this.storage,pending.before);this.storage.setItem(PENDING_DELETION_KEY,'null');this.guestDeletion=null;clearTimeout(this.undoTimer);this.emit();return true
    }
    const pending=this.pendingDeletion;if(!pending||!this.sync?.cancelPending(pending.commandId))return false
    this.refresh();return true
  }
  restoreBuiltIns(ids:readonly number[]){const next=vocabularyRepository.restoreBuiltIns(this.data,ids);if(this.scope==='guest')recordDeletionJournal(this.storage,next.vocabulary,ids);this.commit(next,'restore')}
  clearVocabulary(level:ClearLevel,confirmation=''){
    if(level==='everything'&&confirmation.trim()!=='DELETE')throw Error('Type DELETE exactly to continue.')
    if(level==='everything'&&this.sync){this.sync.cache.queue=[];this.sync.cache.backups=[];this.sync.persist(false)}
    const next=level==='personal'?vocabularyRepository.clearPersonal(this.data):level==='progress'?vocabularyRepository.resetProgress(this.data):vocabularyRepository.clearEverything(this.data)
    if(this.scope==='guest')recordDeletionJournal(this.storage,next.vocabulary,[...this.data.vocabulary.hiddenBuiltinIds,...combinedCatalog(this.data.vocabulary).filter(word=>word.id<1_000_000).map(word=>word.id)])
    this.commit(next,level==='personal'?'clear-user':level==='progress'?'reset-progress':'clear-all')
    if(level==='everything'){
      for(const key of ['kelime-learned','kelime-daily-test',PENDING_DELETION_KEY])try{this.storage.setItem(key,'null')}catch{this.storageError=true}
      const storage=this.storage as StorageAccess&Partial<Pick<Storage,'length'|'key'|'removeItem'>>
      if(typeof storage.length==='number'&&storage.key&&storage.removeItem)for(let index=storage.length-1;index>=0;index--){const key=storage.key(index);if(key?.startsWith('kelime-migration-backup:'))storage.removeItem(key)}
    }
  }
  exportConflict(id:string):string {const op=this.sync?.cache.backups.find(p=>p.id===id)??this.sync?.cache.queue.find(p=>p.id===id);return JSON.stringify(op,null,2)}
  accountCells():Cells{return this.sync?.cache.base.cells??{}}
}
let instance:Application|undefined
export function application(){if(!instance)instance=new Application(localStorage);return instance}
export function connectApplication(app:Application){
  let observed=false,active=true
  const restored=app.restoreAccount()
  const unsubscribe=app.auth.subscribe(user=>{observed=true;queueMicrotask(()=>{if(active)void restored.then(()=>app.acceptAuth(user))})})
  void app.auth.current().then(user=>{if(active&&!observed)void restored.then(()=>app.acceptAuth(user))}).catch(error=>{if(active)app.reportError(error)})
  const refresh=()=>{if(document.visibilityState==='visible'&&navigator.onLine)void app.retry().catch(error=>app.reportError(error))}
  const online=()=>app.setOnline(navigator.onLine)
  const storage=(event:StorageEvent)=>{if(event.key==='kelime-vocabulary-deletion-journal')app.reloadGuest()}
  window.addEventListener('focus',refresh);window.addEventListener('online',online);window.addEventListener('offline',online);window.addEventListener('storage',storage)
  const timer=setInterval(refresh,30000)
  return()=>{active=false;unsubscribe();clearInterval(timer);window.removeEventListener('focus',refresh);window.removeEventListener('online',online);window.removeEventListener('offline',online);window.removeEventListener('storage',storage)}
}
