import type { Correction, PracticeTarget, PracticeTurn, ValidatedFeedback, WordFeedback } from './practiceModel.ts'

const object=(value:unknown):Record<string,unknown>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid practice feedback.')
  return value as Record<string,unknown>
}
const text=(value:unknown,max=1000):string=>{
  if(typeof value!=='string'||!value.trim()||value.length>max)throw Error('Invalid feedback text.')
  return value
}
export function validateFeedback(value:unknown,targets:readonly Pick<PracticeTarget,'wordId'>[],turns:readonly PracticeTurn[]):ValidatedFeedback{
  const raw=object(value),ids=new Set(targets.map(t=>t.wordId)),seen=new Set<number>()
  const learners=new Map(turns.filter(t=>t.role==='learner').map(t=>[t.id,t]))
  if(!Array.isArray(raw.words)||raw.words.length!==targets.length||!Array.isArray(raw.corrections)||raw.corrections.length>32||!Array.isArray(raw.strengths)||raw.strengths.length>8)throw Error('Invalid feedback structure.')
  const words:WordFeedback[]=raw.words.map(value=>{
    const w=object(value),id=w.wordId
    if(typeof id!=='number'||!ids.has(id)||seen.has(id))throw Error('Feedback contains an invalid or duplicate target.')
    seen.add(id)
    if(typeof w.outcome!=='string'||!['correct','partial','needsPractice','notAttempted'].includes(w.outcome)||typeof w.retrieval!=='string'||!['recognized','missing','unassessed'].includes(w.retrieval)||typeof w.semantic!=='string'||!['acceptable','inappropriate','unassessed'].includes(w.semantic)||typeof w.grammar!=='string'||!['correct','needsCorrection','unassessed'].includes(w.grammar))throw Error('Invalid feedback outcome.')
    if(!Array.isArray(w.evidence)||w.evidence.length>16||new Set(w.evidence).size!==w.evidence.length||w.evidence.some(id=>typeof id!=='string'||!learners.has(id)))throw Error('Feedback evidence must reference learner turns.')
    if(w.outcome==='notAttempted'?(w.evidence.length!==0||w.retrieval!=='unassessed'||w.semantic!=='unassessed'||w.grammar!=='unassessed'):!w.evidence.length)throw Error('Feedback contradicts its evidence.')
    if(w.outcome==='correct'&&(w.retrieval!=='recognized'||w.semantic==='inappropriate'))throw Error('Invalid successful vocabulary outcome.')
    if(w.outcome==='partial'&&(w.retrieval!=='recognized'||w.semantic!=='inappropriate'))throw Error('Partial vocabulary outcome requires a usage issue.')
    if(w.outcome==='needsPractice'&&w.retrieval!=='missing'&&w.semantic!=='inappropriate')throw Error('Grammar alone cannot imply vocabulary failure.')
    return {wordId:id,outcome:w.outcome as WordFeedback['outcome'],retrieval:w.retrieval as WordFeedback['retrieval'],semantic:w.semantic as WordFeedback['semantic'],grammar:w.grammar as WordFeedback['grammar'],evidence:[...w.evidence] as string[],explanation:text(w.explanation)}
  })
  const corrections:Correction[]=raw.corrections.map(value=>{
    const c=object(value),word=words.find(w=>w.wordId===c.wordId)
    if(!word||typeof c.turnId!=='string'||!word.evidence.includes(c.turnId)||typeof c.kind!=='string'||!['grammar','vocabulary'].includes(c.kind))throw Error('Invalid correction reference.')
    const original=text(c.original),replacement=text(c.replacement)
    if(!learners.get(c.turnId)!.text.includes(original)||original===replacement||c.kind==='grammar'&&word.grammar!=='needsCorrection'||c.kind==='vocabulary'&&!['partial','needsPractice'].includes(word.outcome))throw Error('Unsupported correction.')
    return {wordId:word.wordId,turnId:c.turnId,kind:c.kind as Correction['kind'],original,replacement}
  })
  const suggestedReviewWordIds=words.filter(w=>w.outcome==='partial'||w.outcome==='needsPractice').map(w=>w.wordId)
  if(raw.suggestedReviewWordIds!==undefined&&(!Array.isArray(raw.suggestedReviewWordIds)||new Set(raw.suggestedReviewWordIds).size!==raw.suggestedReviewWordIds.length||raw.suggestedReviewWordIds.some(id=>!suggestedReviewWordIds.includes(id as number))))throw Error('Invalid review recommendation.')
  return {words,corrections,strengths:raw.strengths.map(s=>text(s,300)),suggestedReviewWordIds}
}
export function validateTutorTurn(value:unknown):string{
  return text(object(value).message,1500)
}
