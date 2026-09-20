import {activeRequests} from './aiPractice/learningEvidence.ts'
import type {ReviewRequests} from './aiPractice/learningEvidence.ts'
import {directionalReviewDue,isReviewDue} from './learningHistory.ts'
import type {WordLearningHistory} from './learningHistory.ts'
import type {TestDirection} from './learningTypes.ts'
export const reviewEligible=(wordId:number,h:WordLearningHistory,now:number,requests:ReviewRequests={})=>isReviewDue(h,now)||activeRequests(requests,wordId).length>0
export const directionEligible=(wordId:number,h:WordLearningHistory,direction:TestDirection,now:number,requests:ReviewRequests={})=>directionalReviewDue(h,direction,now)||activeRequests(requests,wordId,direction).length>0
