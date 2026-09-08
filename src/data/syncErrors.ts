import type {ErrorCategory} from './models.ts'
export function classifySyncError(error:unknown): {category:ErrorCategory;message:string} {
  const value=error as {code?:string;status?:number;message?:string}
  const code=value?.code??'', status=value?.status
  const category:ErrorCategory=code==='KS409'?'conflict':code==='42501'||code==='PGRST301'||status===401||status===403?'auth':code==='STORAGE'?'storage':status===429||status!==undefined&&status>=500||['40001','40P01','57014'].includes(code)||code.startsWith('08')?'transient':code||status!==undefined&&status>=400?'permanent':'transient'
  return {category,message:value?.message??'Synchronization failed.'}
}
