import { questionContent, questionMatches } from '../dailyTestModel.ts'
import type { TestSession } from '../dailyTestModel.ts'
import type { VocabularyWord } from '../vocabulary.ts'
import type { LearningHistory } from '../learningHistory.ts'
import { buildPracticeContext } from './contextBuilder.ts'
import { selectPracticeTargets } from './targetWordSelector.ts'
import { validateFeedback, validateTutorTurn } from './feedbackValidator.ts'
import { practiceProgress, transition } from './practiceModel.ts'
import type { PracticeMode, PracticeSession, WordFeedback } from './practiceModel.ts'
import type { AIPracticeProvider } from './provider.ts'
import { createReviewRequests } from './reviewRequest.ts'
import type { ReviewRequest } from './reviewRequest.ts'

export class PracticeService {
  private state:PracticeSession
  private listeners=new Set<()=>void>()
  private controller=new AbortController()
  private disposed=false
  private started=false
  private readonly provider:AIPracticeProvider
  private readonly now:()=>number
  private readonly id:()=>string
  private requests:ReviewRequest[]=[]
  constructor(options:{quiz:TestSession;catalog:readonly VocabularyWord[];history:LearningHistory;mode:PracticeMode;provider:AIPracticeProvider;now?:()=>number;id?:()=>string}){
    this.provider=options.provider;this.now=options.now??Date.now;this.id=options.id??(()=>crypto.randomUUID())
    const at=this.now(),targets=selectPracticeTargets(options.quiz,options.catalog,options.history,at)
    if(!targets.length)throw Error('No available quiz words to practice.')
    this.state={id:this.id(),sourceQuizId:options.quiz.syncId??null,targets,mode:options.mode,startedAt:at,endedAt:null,status:'preparing',turns:[],feedback:null,outcomes:[],error:null}
  }
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener)}}
  getSnapshot=()=>this.state
  private publish(state:PracticeSession){this.state=state;for(const listener of this.listeners)listener()}
  private move(status:PracticeSession['status']){this.publish(transition(this.state,status,this.now()))}
  private get active(){return !this.disposed&&!this.controller.signal.aborted}
  private request(){return {context:buildPracticeContext(this.state.targets,this.state.mode),turns:this.state.turns.map(t=>({...t}))}}
  private tutor(text:string){this.publish({...this.state,turns:[...this.state.turns,{id:this.id(),role:'tutor',text,at:this.now()}]})}
  private currentTarget(){const pending=practiceProgress(this.state).unpracticed;return this.state.targets.find(t=>pending.includes(t.wordId))}
  private voicePrompt(){const target=this.currentTarget();if(!target)return 'All targets have been practiced. End practice to see your feedback.';const content=questionContent(target);return `What is the ${content.answerLang==='tr'?'Turkish':'English'} meaning of “${content.prompt}”?`}
  private fail(){if(this.active){this.publish({...transition(this.state,'failed',this.now()),error:'Mock practice is currently unavailable. Your completed quiz is unchanged.'});this.controller.abort();this.provider.dispose()}}
  async start(){
    if(this.started||!this.active)return
    this.started=true
    try{const message=this.state.mode==='voiceAnswer'?this.voicePrompt():validateTutorTurn(await this.provider.prepare(this.request(),this.controller.signal));if(!this.active)return;this.tutor(message);this.move('ready')}catch{this.fail()}
  }
  async submit(input:string){
    if(!this.active||this.state.status!=='ready'||!input.trim()||input.length>2000||this.state.turns.filter(t=>t.role==='learner').length>=16)return false
    const target=this.currentTarget()
    if(!target)return false
    const turn={id:this.id(),role:'learner' as const,text:input.trim(),at:this.now(),targetWordId:target.wordId}
    this.publish({...transition(this.state,'processing',this.now()),turns:[...this.state.turns,turn]})
    try{
      if(this.state.mode==='voiceAnswer'){
        const correct=questionMatches(turn.text,target)
        const outcome:WordFeedback={wordId:target.wordId,outcome:correct?'correct':'needsPractice',retrieval:correct?'recognized':'missing',semantic:'unassessed',grammar:'unassessed',evidence:[turn.id],explanation:correct?'Matches an accepted answer.':'Does not match an accepted answer.'}
        const outcomes=[...this.state.outcomes.filter(w=>w.wordId!==target.wordId),outcome]
        const feedback=validateFeedback({words:this.completeWords(outcomes),corrections:[],strengths:[]},this.state.targets,this.state.turns)
        this.publish({...this.state,outcomes:feedback.words})
        this.tutor(`${correct?'Correct.':'Accepted answers: '+target.snapshot.acceptedAnswers.join('; ')+'.'} ${this.voicePrompt()}`)
      }else{
        const response=await this.provider.respond(this.request(),this.controller.signal)
        if(!this.active)return false
        const message=validateTutorTurn(response)
        const feedback=validateFeedback((response as {feedback?:unknown}).feedback,this.state.targets,this.state.turns)
        this.publish({...this.state,outcomes:feedback.words});this.tutor(message)
      }
      this.move('ready');return true
    }catch{this.fail();return false}
  }
  private completeWords(outcomes:WordFeedback[]):WordFeedback[]{return this.state.targets.map(t=>outcomes.find(w=>w.wordId===t.wordId)??{wordId:t.wordId,outcome:'notAttempted',retrieval:'unassessed',semantic:'unassessed',grammar:'unassessed',evidence:[],explanation:'Not practiced in this session.'})}
  async end(){
    if(!this.active||this.state.status!=='ready')return
    this.move('processing')
    try{
      const raw=this.state.mode==='voiceAnswer'?{words:this.completeWords(this.state.outcomes),corrections:[],strengths:[]}:await this.provider.finish(this.request(),this.controller.signal)
      if(!this.active)return
      const feedback=validateFeedback(raw,this.state.targets,this.state.turns)
      this.publish({...transition(this.state,'feedback',this.now()),feedback,outcomes:feedback.words})
    }catch{this.fail()}
  }
  stageReview(selected:readonly number[],catalog:readonly VocabularyWord[]){
    if(!this.active||this.state.status!=='feedback')throw Error('Practice feedback is no longer active.')
    const next=createReviewRequests(this.state,selected,catalog,this.now())
    for(const request of next)if(!this.requests.some(r=>r.wordId===request.wordId))this.requests.push(request)
    return this.requests.map(r=>({...r}))
  }
  finish(){if(this.active&&this.state.status==='feedback'){this.move('completed');this.controller.abort();this.provider.dispose()}}
  cancel(){if(this.active&&!['completed','cancelled','failed'].includes(this.state.status)){this.move('cancelled');this.controller.abort();this.provider.dispose();this.requests=[]}}
  dispose(){if(this.disposed)return;this.cancel();this.controller.abort();this.provider.dispose();this.requests=[];this.disposed=true;this.listeners.clear()}
}
