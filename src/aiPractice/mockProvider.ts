import { cleanText } from '../answerMatching.ts'
import type { AIPracticeProvider, ProviderRequest } from './provider.ts'
import type { Correction, WordFeedback } from './practiceModel.ts'

// Explicitly limited mock recognition, not a semantic or grammatical language model.
export function containsPhrase(input:string,phrase:string){
  const normalized=cleanText(input).toLocaleLowerCase('en'),needle=cleanText(phrase).toLocaleLowerCase('en').replace(/[.*+?^${}()|[\]\\]/g,'\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}_])${needle}($|[^\\p{L}\\p{N}_])`,'u').test(normalized)
}
function evaluate({context,turns}:ProviderRequest){
  const learners=turns.filter(t=>t.role==='learner'),corrections:Correction[]=[]
  const words:WordFeedback[]=context.targets.map(target=>{
    const recognized=learners.filter(t=>[target.english,...target.englishAlternatives].some(word=>containsPhrase(t.text,word)))
    const assigned=learners.findLast(t=>t.targetWordId===target.wordId),evidence=recognized.at(-1)??assigned
    if(!evidence)return {wordId:target.wordId,outcome:'notAttempted',retrieval:'unassessed',semantic:'unassessed',grammar:'unassessed',evidence:[],explanation:'Not practiced in this session.'}
    if(!recognized.length)return {wordId:target.wordId,outcome:'needsPractice',retrieval:'missing',semantic:'unassessed',grammar:'unassessed',evidence:[evidence.id],explanation:'The requested word or an explicit alternative was not recognized by this mock.'}
    const original=`want ${target.english.toLocaleLowerCase('en')}`
    const match=evidence.text.toLocaleLowerCase('en').indexOf(original)
    const verb=target.partOfSpeech==='verb'||['achieve','avoid','improve','learn','read','give up'].includes(target.english.toLocaleLowerCase('en'))
    const hasCorrection=verb&&match>=0&&containsPhrase(evidence.text,original)
    if(hasCorrection)corrections.push({wordId:target.wordId,turnId:evidence.id,kind:'grammar',original:evidence.text.slice(match,match+original.length),replacement:evidence.text.slice(match,match+4)+' to '+evidence.text.slice(match+5,match+original.length)})
    const knownExample=target.english.toLocaleLowerCase('en')==='achieve'&&/^i want (?:to )?achieve my goals?[.!]?$/i.test(evidence.text.trim())
    if(target.english.toLocaleLowerCase('en')==='achieve'&&/^i achieve to school[.!]?$/i.test(evidence.text.trim())){
      corrections.push({wordId:target.wordId,turnId:evidence.id,kind:'vocabulary',original:evidence.text,replacement:'I go to school.'})
      return {wordId:target.wordId,outcome:'partial',retrieval:'recognized',semantic:'inappropriate',grammar:'unassessed',evidence:[evidence.id],explanation:'The word was retrieved, but this supported mock example uses achieve where go is needed.'}
    }
    return {wordId:target.wordId,outcome:'correct',retrieval:'recognized',semantic:knownExample?'acceptable':'unassessed',grammar:hasCorrection?'needsCorrection':'unassessed',evidence:[evidence.id],explanation:knownExample?'Recognized vocabulary in a supported example; grammar is evaluated separately.':'Word recognized. General semantic and grammatical quality are not assessed by this mock.'}
  })
  return {words,corrections,strengths:words.some(w=>w.retrieval==='recognized')?['You retrieved target vocabulary in your responses.']:[]}
}
function prompt(request:ProviderRequest){
  const feedback=evaluate(request),target=request.context.targets.find(t=>feedback.words.some(w=>w.wordId===t.wordId&&w.outcome==='notAttempted'))
  if(!target)return 'Thanks for practicing. You can end practice to see your feedback.'
  if(request.context.mode==='useTheWord')return `Make an English sentence using “${target.english}”.`
  const cues:Record<string,string>={achieve:'Tell me about a goal you are working toward.',avoid:'What do you try to stay away from during a busy week?',opportunity:'Tell me about a chance you would like to take.',improve:'What would you like to get better at?',challenge:'Tell me about something difficult you have faced.'}
  return cues[target.english.toLocaleLowerCase('en')]??`Tell me about a real situation connected to “${target.english}”.`
}
export class MockPracticeProvider implements AIPracticeProvider {
  private disposed=false
  private readonly failure:'prepare'|'respond'|'finish'|undefined
  constructor(options:{failAt?:'prepare'|'respond'|'finish'}={}){this.failure=options.failAt}
  private check(stage:string,signal:AbortSignal){if(signal.aborted||this.disposed)throw Error('Practice cancelled.');if(this.failure===stage)throw Error('Simulated provider failure.')}
  async prepare(request:ProviderRequest,signal:AbortSignal){this.check('prepare',signal);return {message:prompt(request)}}
  async respond(request:ProviderRequest,signal:AbortSignal){this.check('respond',signal);return {message:prompt(request),feedback:evaluate(request)}}
  async finish(request:ProviderRequest,signal:AbortSignal){this.check('finish',signal);return evaluate(request)}
  dispose(){this.disposed=true}
}
