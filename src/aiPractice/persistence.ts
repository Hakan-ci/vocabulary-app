import type {PracticeSession} from './practiceModel.ts'
export type PracticeSaveResult={pendingSync:boolean;synchronized?:boolean}
export interface PracticePersistence {
 complete(session:PracticeSession):Promise<PracticeSaveResult>
 request(sessionId:string,selected:readonly number[]):Promise<PracticeSaveResult>
}
