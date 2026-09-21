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

/** Independent selection never changes mastery or scheduling. */
export function selectIndependentTargets(catalog:readonly VocabularyWord[],state:Pick<LearningState,'history'|'reviewRequests'|'aiEvidence'|'session'|'sessions'>,now:number,selected?:readonly number[]):PracticeTarget[]{
  const week=7*86400000,chosen=selected?new Set(selected):null
  if(chosen&&(chosen.size<1||chosen.size>8||chosen.size!==selected!.length||[...chosen].some(id=>!catalog.some(w=>w.id===id))))throw Error('Choose one to eight available words.')
  const quizzes=[state.session,...Object.values(state.sessions??{}).filter(s=>s.source==='daily').map(s=>s.practice)].filter(s=>s?.phase==='completed'&&s.completedAt!=null&&s.completedAt>=now-week)
  const ranked=catalog.filter(w=>!chosen||chosen.has(w.id)).flatMap(word=>directions.map(direction=>{
    const h=state.history[word.id]??emptyWordHistory(),s=h[direction],difficulty=calculateDifficulty(s,now)
    const due=directionEligible(word.id,h,direction,now,state.reviewRequests)
    const evidence=Object.values(state.aiEvidence).filter(e=>e.words.some(w=>w.wordId===word.id&&w.direction===direction&&w.outcome!=='notAttempted')).map(e=>e.completedAt)
    const last=Math.max(s.lastTestedAt??0,...evidence)
    const newlyLearned=quizzes.some(q=>q!.newlyLearnedIds.includes(word.id))
    const weak=difficulty.score>50||(s.timesMissed>0&&s.consecutiveKnown<2)
    const missed=s.timesMissed>0&&s.consecutiveKnown===0&&(s.lastTestedAt??0)>=now-week
    const priority=due?0:weak?1:missed?2:newlyLearned?3:last>0&&last<now-week?4:s.timesTested===0&&evidence.length===0?5:6
    const target:PracticeTarget={...snapshotQuestion({wordId:word.id,direction},catalog,()=>0),difficulty,newlyLearned,due,recent:{timesTested:s.timesTested,timesKnown:s.timesKnown,timesMissed:s.timesMissed,consecutiveKnown:s.consecutiveKnown}}
    return {target,priority,last}
  })).sort((a,b)=>a.priority-b.priority||b.target.difficulty.score-a.target.difficulty.score||a.last-b.last||a.target.wordId-b.target.wordId||directions.indexOf(a.target.direction)-directions.indexOf(b.target.direction))
  const seen=new Set<number>()
  return ranked.filter(({target})=>{if(seen.has(target.wordId))return false;seen.add(target.wordId);return true}).slice(0,8).map(x=>x.target)
}
import { snapshotQuestion } from '../dailyTestModel.ts'
import { directions } from '../learningTypes.ts'
import { directionEligible } from '../reviewEligibility.ts'
import type { LearningState } from '../learningState.ts'
