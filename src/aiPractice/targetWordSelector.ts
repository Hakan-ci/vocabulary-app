import type { TestSession } from '../dailyTestModel.ts'
import type { VocabularyWord } from '../vocabulary.ts'
import { calculateDifficulty, directionalReviewDue, emptyWordHistory } from '../learningHistory.ts'
import type { LearningHistory } from '../learningHistory.ts'
import type { PracticeTarget } from './practiceModel.ts'

export function selectPracticeTargets(session:TestSession,catalog:readonly VocabularyWord[],history:LearningHistory,now:number):PracticeTarget[]{
  if(session.phase!=='completed')return []
  const available=new Set(catalog.map(w=>w.id)),seen=new Set<number>()
  return session.results.flatMap((result,index)=>{
    if(!available.has(result.wordId)||seen.has(result.wordId))return []
    seen.add(result.wordId)
    const h=history[result.wordId]??emptyWordHistory(),s=h[result.direction],difficulty=calculateDifficulty(s,now)
    const newlyLearned=session.newlyLearnedIds.includes(result.wordId),due=directionalReviewDue(h,result.direction,now)
    const weak=difficulty.score>50||(s.timesMissed>0&&s.consecutiveKnown<2)
    const priority=!result.correct?0:weak?1:newlyLearned?2:due?3:4
    const target:PracticeTarget={wordId:result.wordId,direction:result.direction,snapshot:structuredClone(result.snapshot),difficulty,quizCorrect:result.correct,quizKnown:result.known,newlyLearned,due,recent:{timesTested:s.timesTested,timesKnown:s.timesKnown,timesMissed:s.timesMissed,consecutiveKnown:s.consecutiveKnown}}
    return [{target,index,priority}]
  }).sort((a,b)=>a.priority-b.priority||b.target.difficulty.score-a.target.difficulty.score||a.index-b.index||a.target.wordId-b.target.wordId).slice(0,8).map(item=>item.target)
}
