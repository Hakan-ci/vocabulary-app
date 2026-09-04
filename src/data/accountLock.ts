// One active writer per account/browser prevents two tabs overwriting the same durable queue.
// Different browsers/devices still synchronize concurrently through database revisions.
export async function acquireAccountLock(project:string,user:string):Promise<()=>void> {
 if(typeof window==='undefined')return()=>{}
 if(!navigator.locks)throw Error('Account synchronization requires a secure browser connection (HTTPS or localhost). Local mode remains available.')
 return new Promise((resolve,reject)=>{
  void navigator.locks.request(`kelime-writer:${project}:${user}`,{ifAvailable:true},lock=>{
   if(!lock){reject(Error('This account is active in another tab. Close that tab, then choose Retry sync here.'));return}
   return new Promise<void>(release=>{resolve(release)})
  }).catch(reject)
 })
}
