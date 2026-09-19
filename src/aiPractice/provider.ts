import type { PracticeContext } from './contextBuilder.ts'
import type { PracticeTurn } from './practiceModel.ts'

export type ProviderRequest = {context:PracticeContext;turns:readonly PracticeTurn[]}
export interface AIPracticeProvider {
  prepare(request:ProviderRequest,signal:AbortSignal):Promise<unknown>
  respond(request:ProviderRequest,signal:AbortSignal):Promise<unknown>
  finish(request:ProviderRequest,signal:AbortSignal):Promise<unknown>
  dispose():void
}
