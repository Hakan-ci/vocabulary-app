import type { PracticeContext } from './contextBuilder.ts'
import type { PracticeTurn } from './practiceModel.ts'

export type ProviderAction = 'prepare'|'respond'|'finish'
export type ProviderRequest = {sessionId:string;requestId:string;context:PracticeContext;turns:readonly PracticeTurn[]}
export interface AIPracticeProvider {
  readonly evaluator?: 'mock'|'openai'
  readonly recoverable?: boolean
  prepare(request:ProviderRequest,signal:AbortSignal):Promise<unknown>
  respond(request:ProviderRequest,signal:AbortSignal):Promise<unknown>
  finish(request:ProviderRequest,signal:AbortSignal):Promise<unknown>
  dispose():void
}
