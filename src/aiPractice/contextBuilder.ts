import type { PracticeMode, PracticeTarget } from './practiceModel.ts'

export function buildPracticeContext(targets:readonly PracticeTarget[],mode:PracticeMode){
  return {mode,targets:targets.map(t=>({wordId:t.wordId,english:t.snapshot.word.english,turkishMeanings:[...t.snapshot.word.turkishMeanings],englishAlternatives:[...(t.snapshot.word.englishAlternatives??[])],...(t.snapshot.word.example?{example:t.snapshot.word.example}:{}),...(t.snapshot.word.partOfSpeech?{partOfSpeech:t.snapshot.word.partOfSpeech}:{}),direction:t.direction,difficulty:{score:t.difficulty.score,level:t.difficulty.level},...(t.quizCorrect===undefined?{}:{quiz:{correct:t.quizCorrect,known:t.quizKnown!,newlyLearned:t.newlyLearned,due:t.due}}),recent:{timesTested:t.recent.timesTested,timesKnown:t.recent.timesKnown,timesMissed:t.recent.timesMissed,consecutiveKnown:t.recent.consecutiveKnown}}))}
}
export type PracticeContext = ReturnType<typeof buildPracticeContext>
