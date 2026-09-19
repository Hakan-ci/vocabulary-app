import type { QuestionSnapshot } from '../dailyTestModel.ts'
import type { Difficulty } from '../learningTypes.ts'

export type PracticeMode = 'voiceAnswer' | 'useTheWord' | 'conversation'
export const practiceModeLabels: Record<PracticeMode,string> = {voiceAnswer:'Voice Answer (typed simulation)',useTheWord:'Use the Word',conversation:'Conversation'}
export type PracticeTarget = QuestionSnapshot & { difficulty: Difficulty; quizCorrect: boolean; quizKnown: boolean; newlyLearned: boolean; due: boolean; recent: {timesTested:number;timesKnown:number;timesMissed:number;consecutiveKnown:number} }
export type PracticeTurn = { id:string; role:'learner'|'tutor'; text:string; at:number; targetWordId?:number }
export type Outcome = 'correct'|'partial'|'needsPractice'|'notAttempted'
export type WordFeedback = {wordId:number;outcome:Outcome;retrieval:'recognized'|'missing'|'unassessed';semantic:'acceptable'|'inappropriate'|'unassessed';grammar:'correct'|'needsCorrection'|'unassessed';evidence:string[];explanation:string}
export type Correction = {wordId:number;turnId:string;kind:'grammar'|'vocabulary';original:string;replacement:string}
export type ValidatedFeedback = {words:WordFeedback[];corrections:Correction[];strengths:string[];suggestedReviewWordIds:number[]}
export type PracticeStatus = 'preparing'|'ready'|'listening'|'processing'|'tutorSpeaking'|'feedback'|'completed'|'cancelled'|'failed'
export type PracticeSession = {id:string;sourceQuizId:string|null;targets:PracticeTarget[];mode:PracticeMode;startedAt:number;endedAt:number|null;status:PracticeStatus;turns:PracticeTurn[];feedback:ValidatedFeedback|null;outcomes:WordFeedback[];error:string|null}
const transitions:Record<PracticeStatus,PracticeStatus[]> = {preparing:['ready','cancelled','failed'],ready:['processing','listening','feedback','cancelled','failed'],listening:['ready','processing','cancelled','failed'],processing:['ready','tutorSpeaking','feedback','cancelled','failed'],tutorSpeaking:['ready','cancelled','failed'],feedback:['completed','cancelled','failed'],completed:[],cancelled:[],failed:[]}
export function transition(session:PracticeSession,status:PracticeStatus,now:number):PracticeSession {
  if(!transitions[session.status].includes(status))throw Error('Invalid practice transition.')
  return {...session,status,endedAt:['completed','cancelled','failed'].includes(status)?now:session.endedAt}
}
export function practiceProgress(session:PracticeSession){
  const outcomes=session.feedback?.words??session.outcomes
  return {attempted:outcomes.filter(w=>w.outcome!=='notAttempted').map(w=>w.wordId),successful:outcomes.filter(w=>w.outcome==='correct').map(w=>w.wordId),partial:outcomes.filter(w=>w.outcome==='partial').map(w=>w.wordId),unpracticed:session.targets.filter(t=>!outcomes.some(w=>w.wordId===t.wordId&&w.outcome!=='notAttempted')).map(t=>t.wordId)}
}
