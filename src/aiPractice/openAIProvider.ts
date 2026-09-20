import type { AIPracticeProvider, ProviderAction, ProviderRequest } from './provider.ts'

export type PracticeTransport=(body:unknown,signal:AbortSignal)=>Promise<unknown>
/** No paid retries happen here: every invocation is an explicit service action. */
export class OpenAIPracticeProvider implements AIPracticeProvider {
  readonly evaluator='openai' as const
  readonly recoverable=true
  private disposed=false
  private transport:PracticeTransport
  private id:()=>string
  constructor(transport:PracticeTransport,id=()=>crypto.randomUUID()){this.transport=transport;this.id=id}
  private async call(action:ProviderAction,request:ProviderRequest,signal:AbortSignal){
    if(this.disposed)throw Error('Practice is closed.')
    const deadline=AbortSignal.timeout(35000)
    const result=await this.transport({action,...request,attemptId:this.id()},AbortSignal.any([signal,deadline]))
    if(this.disposed||signal.aborted)throw Error('Practice is closed.')
    return result
  }
  prepare(request:ProviderRequest,signal:AbortSignal){return this.call('prepare',request,signal)}
  respond(request:ProviderRequest,signal:AbortSignal){return this.call('respond',request,signal)}
  finish(request:ProviderRequest,signal:AbortSignal){return this.call('finish',request,signal)}
  dispose(){this.disposed=true}
}
