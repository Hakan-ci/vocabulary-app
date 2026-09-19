import type { VocabularyWord } from '../vocabulary.ts'
import type { TestDirection } from '../learningTypes.ts'
import type { PracticeSession } from './practiceModel.ts'

export type ReviewRequest = {wordId:number;direction:TestDirection;requestedAt:number;source:'aiPractice';sourceSessionId:string}
export function createReviewRequests(session:PracticeSession,selected:readonly number[],catalog:readonly VocabularyWord[],now:number):ReviewRequest[]{
  if(!session.feedback||!['feedback','completed'].includes(session.status))throw Error('Validated feedback is required.')
  return [...new Set(selected)].map(wordId=>{
    const target=session.targets.find(t=>t.wordId===wordId)
    if(!target||!catalog.some(w=>w.id===wordId)||!session.feedback!.suggestedReviewWordIds.includes(wordId))throw Error('Invalid review selection.')
    return {wordId,direction:target.direction,requestedAt:now,source:'aiPractice',sourceSessionId:session.id}
  })
}
