import type {StorageAccess} from './localRepository.ts'
import type {SyncCache} from './models.ts'
import {parseCache} from './syncService.ts'
export interface AccountStore {load(key:string,legacy:StorageAccess):Promise<SyncCache>;save(key:string,value:SyncCache):Promise<void>}
export class IndexedAccountStore implements AccountStore {
 private database:Promise<IDBDatabase>|undefined
 constructor(privateName='kelime-accounts'){this.name=privateName}
 private name:string
 private open(){return this.database??=new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open(this.name,1);request.onupgradeneeded=()=>request.result.createObjectStore('accounts');request.onsuccess=()=>{request.result.onversionchange=()=>request.result.close();resolve(request.result)};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close older Kelime windows to upgrade offline storage.'))})}
 async load(key:string,legacy:StorageAccess){
  const db=await this.open()
  const stored=await new Promise<string|undefined>((resolve,reject)=>{const tx=db.transaction('accounts','readonly'),request=tx.objectStore('accounts').get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error)})
  if(stored!==undefined){
    const cache=parseCache(stored)
    if(JSON.parse(stored).version!==6)await new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(stored,key+':pre-v6');tx.objectStore('accounts').put(JSON.stringify(cache),key);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error)})
    return cache
  }
  const cache=parseCache(legacy.getItem(key))
  // The account record itself is the migration receipt. Never erase the legacy backup.
  await this.save(key,cache)
  return cache
 }
 async save(key:string,value:SyncCache){const db=await this.open();const encoded=JSON.stringify(value);await new Promise<void>((resolve,reject)=>{const tx=db.transaction('accounts','readwrite');tx.objectStore('accounts').put(encoded,key);tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error??Error('Offline changes could not be saved.'))})}
 async close(){(await this.database)?.close()}
}
export const accountStore=new IndexedAccountStore()
