import test from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/vocabulary.ts'
import { answerMatches, normalizeAnswer, uniqueAnswers } from '../src/answerMatching.ts'
import { validateEntry, englishKey } from '../src/wordFields.ts'
import { parseVocabulary, classifyPreview } from '../src/vocabularyImport.ts'
import { USER_VOCABULARY_KEY, parseUserVocabulary, combinedCatalog, saveImportedWords, saveEditedWord, readUserVocabulary, legacyCatalog } from '../src/userVocabulary.ts'
import { createSession, snapshotQuestion, questionContent, submitAnswer, assessAnswer, parseSession, sessionSummary } from '../src/dailyTestModel.ts'
import { emptyHistory, recordAssessment, emptyWordHistory } from '../src/learningHistory.ts'
import { emptyLearningState, assessReviewState, loadLearningState, LEARNING_STATE_KEY } from '../src/learningState.ts'
import { createReviewSession, parseReviewSession } from '../src/reviewModel.ts'
import { dashboard } from '../src/progressModel.ts'
const now = 10000000
const custom = { id:1000000, english:'discover', englishAlternatives:['find out'], turkishMeanings:['keşfetmek','ortaya çıkarmak'], partOfSpeech:'verb', tags:['My words'],createdAt:null, example:'We discovered the cause of the problem.' }
function storage(initial={}) { const data=new Map(Object.entries(initial));return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)} }
function legacySession(session) {
  const {submittedCorrect:_correct,...rest}=session
  return {...rest,version:3,questions:session.questions.map(q=>({wordId:q.wordId,direction:q.direction})),results:session.results.map(r=>({wordId:r.wordId,direction:r.direction,answer:r.answer,known:r.known}))}
}
test('strict matching preserves Turkish letters, casing, phrases and only ignores trailing punctuation',()=>{
  for(const answer of ['çalıştırmak',' İŞLETMEK. ','  koşmak,!?… ']) assert.equal(answerMatches(answer,['koşmak','çalıştırmak','işletmek']),true)
  assert.equal(answerMatches('cagirmak','çağırmak'),false)
  assert.equal(answerMatches('çağırmak','çağırmak'),true)
  assert.equal(answerMatches(' ÇAĞIRMAK ','çağırmak'),true)
  assert.equal(answerMatches('  FIND   OUT. ',['discover','find out'],'turkishToEnglish'),true)
  for(const answer of ['find','discover more','find-out','']) assert.equal(answerMatches(answer,['discover','find out'],'turkishToEnglish'),false)
  assert.equal(answerMatches('koşmak; çalıştırmak',['koşmak','çalıştırmak']),false)
  assert.equal(answerMatches('cagirmak','çağırmak','englishToTurkish','legacy'),true)
  assert.equal(answerMatches('koşmak.','koşmak','englishToTurkish','legacy'),false)
  assert.equal(normalizeAnswer('  iyi   akşamlar... ','englishToTurkish'),'iyi akşamlar')
  assert.deepEqual(uniqueAnswers([' iyi akşamlar ','İYİ AKŞAMLAR.','','cagirmak','çağırmak'],'englishToTurkish'),['iyi akşamlar','cagirmak','çağırmak'])
})
test('vocabulary migration falls back to legacy fields and cleans arrays without accent stripping',()=>{
  assert.deepEqual(validateEntry({english:' apple ',turkish:' elma ',type:' noun '}),{english:'apple',turkishMeanings:['elma'],tags:[],partOfSpeech:'noun'})
  const parsed=validateEntry({english:'Discover',turkishMeanings:[' keşfetmek ','KEŞFETMEK.',''],englishAlternatives:['discover','find out',' FIND   OUT. '],partOfSpeech:'verb'})
  assert.deepEqual(parsed.turkishMeanings,['keşfetmek']);assert.deepEqual(parsed.englishAlternatives,['find out'])
  assert.deepEqual(validateEntry({english:'x',turkishMeanings:[null,''],turkish:'eski'}).turkishMeanings,['eski'])
  assert.equal(validateEntry({english:'x',turkishMeanings:['']}),null)
})
test('150 built-ins retain original IDs and contain complete curated fields',()=>{
  assert.equal(words.length,150);assert.equal(new Set(words.map(w=>w.id)).size,150)
  assert.equal(words[0].english,'Hello');assert.equal(words[29].english,'Milk')
  const seen=new Set()
  for(const word of words) {
    assert.ok(word.partOfSpeech && word.example && word.english && word.turkishMeanings.length)
    assert.deepEqual(uniqueAnswers(word.turkishMeanings,'englishToTurkish'),word.turkishMeanings)
    const key=englishKey(word.english)+'|'+word.partOfSpeech
    assert.equal(seen.has(key),false);seen.add(key)
  }
  assert.ok(words.some(w=>w.partOfSpeech==='adverb'));assert.ok(words.some(w=>w.partOfSpeech==='phrasal verb'))
  assert.ok(words.filter(w=>w.turkishMeanings.length>1).length>=20)
})
test('expansion collisions preserve imported IDs and never overwrite the saved meaning',()=>{
  const run=words.find(w=>w.english==='Run')
  const state=parseUserVocabulary({version:1,nextId:1000020,entries:[{id:1000003,english:'run',turkish:'koşmak',type:'verb'},{id:1000004,english:'light',turkish:'hafif',type:'adjective'}]})
  assert.equal(state.nextId,1000020);assert.ok(state.suppressedBuiltinIds.includes(run.id))
  const catalog=combinedCatalog(state)
  assert.ok(catalog.some(w=>w.id===1000003));assert.equal(catalog.some(w=>w.id===run.id),false)
  assert.deepEqual(catalog.find(w=>w.id===1000003).turkishMeanings,['koşmak'])
  assert.deepEqual(parseUserVocabulary(JSON.parse(JSON.stringify(state))),state)
})
test('merge previews consolidate batch meanings and require resolution for different senses',()=>{
  const base=[{...custom,english:'light',turkishMeanings:['ışık'],partOfSpeech:'noun'}]
  let rows=parseVocabulary('light - hafif - adjective\nnovelword - bir anlam; ikinci anlam\nNOVELWORD - ikinci anlam; üçüncü anlam')
  let preview=classifyPreview(rows,base)
  assert.deepEqual(preview.map(r=>r.status),['Needs resolution','Ready','Merge'])
  assert.deepEqual(preview[2].additions,['üçüncü anlam'])
  rows[0].resolution='new';assert.equal(classifyPreview(rows,base)[0].status,'Ready')
  rows[0].resolution=base[0].id;assert.equal(classifyPreview(rows,base)[0].status,'Merge')
  assert.equal(classifyPreview(rows.filter(r=>r.id!==1),base)[1].status,'Ready')
  assert.equal(parseVocabulary('give up - vazgeçmek; ; pes etmek')[0].entry.turkishMeanings.length,2)
  assert.equal(parseVocabulary('x - ; ;')[0].entry,null)
  assert.deepEqual(parseVocabulary('x - a, b')[0].entry.turkishMeanings,['a, b'])
})
test('safe merges keep primary and metadata, edit overrides preserve IDs, and failed writes retain data',()=>{
  const store=storage(), original=words[0]
  const result=saveImportedWords(store,parseVocabulary('Hello - selam; merhaba.'))
  assert.equal(result.added.length,0);assert.deepEqual(result.updated,[0])
  let catalog=combinedCatalog(result.value),hello=catalog.find(w=>w.id===0)
  assert.deepEqual(hello.turkishMeanings,['Merhaba','selam']);assert.equal(hello.example,original.example)
  assert.deepEqual(original.turkishMeanings,['Merhaba'])
  const edited=saveEditedWord(store,0,{...hello,turkishMeanings:['selam','Merhaba'],englishAlternatives:['hi']})
  assert.equal(combinedCatalog(edited).find(w=>w.id===0).turkishMeanings[0],'selam')
  assert.equal(saveImportedWords(store,parseVocabulary('Hello - selam')).updated.length,0)
  const saved=store.getItem(USER_VOCABULARY_KEY)
  assert.throws(()=>saveEditedWord({getItem:store.getItem,setItem(){throw Error('quota')}},0,{...hello,turkishMeanings:['yeni']}))
  assert.equal(store.getItem(USER_VOCABULARY_KEY),saved)
  assert.throws(()=>saveEditedWord(store,0,{...hello,english:'Book'}))
  assert.equal(combinedCatalog(saveEditedWord(store,0,{...hello,english:'Book'},true)).find(w=>w.id===0).english,'Book')
  const batch=saveImportedWords(store,parseVocabulary('unique entry - bir\nunique entry - iki'))
  assert.equal(batch.added.length,1);assert.deepEqual(batch.added[0].turkishMeanings,['bir','iki'])
})
test('new reverse prompts sample all meanings and snapshots survive edits and refresh',()=>{
  const first=snapshotQuestion({wordId:custom.id,direction:'turkishToEnglish'},[custom],()=>0)
  const second=snapshotQuestion({wordId:custom.id,direction:'turkishToEnglish'},[custom],()=>.99)
  assert.equal(first.snapshot.prompt,'keşfetmek');assert.equal(second.snapshot.prompt,'ortaya çıkarmak')
  const catalog=Array.from({length:10},(_,i)=>({...custom,id:custom.id+i}))
  let session=createSession(emptyHistory(catalog),now,()=>.99,'turkishToEnglish',[],catalog)
  session=submitAnswer({...session,draft:'FIND OUT.'})
  assert.equal(session.submittedCorrect,true)
  const changed=catalog.map(w=>({...w,english:'changed',turkishMeanings:['değişti'],englishAlternatives:[]}))
  const restored=parseSession(session,changed)
  assert.deepEqual(restored,session);assert.equal(questionContent(restored.questions[0],changed).prompt,'ortaya çıkarmak')
  const next=assessAnswer(restored,emptyHistory(catalog),false,now)
  assert.equal(next.session.results[0].correct,true);assert.equal(sessionSummary(next.session,changed).score,1)
  assert.equal(parseSession({...session,questions:session.questions.map(q=>({...q,snapshot:null}))},catalog),null)
})
test('legacy sessions keep primary prompt and accent tolerance while future sessions are strict',()=>{
  const catalog=Array.from({length:10},(_,i)=>({...custom,id:1000000+i,turkishMeanings:['çağırmak']}))
  const legacy=legacySession(createSession(emptyHistory(catalog),now,()=>.4,'englishToTurkish',[],catalog))
  const restored=parseSession({...legacy,draft:'cagirmak'},catalog)
  assert.ok(restored.questions.every(q=>q.snapshot.rule==='legacy'))
  assert.equal(submitAnswer(restored).submittedCorrect,true)
  const strict=createSession(emptyHistory(catalog),now,()=>.4,'englishToTurkish',[],catalog)
  assert.equal(submitAnswer({...strict,draft:'cagirmak'}).submittedCorrect,false)
})
test('migration and edits retain activity, favorites, history, Review and legacy source values',()=>{
  const store=storage({[USER_VOCABULARY_KEY]:JSON.stringify({version:1,nextId:1000001,entries:[{id:1000000,english:'discover',turkish:'keşfetmek',type:'verb'}]}),'kelime-favorites':'[0,1000000]'})
  const user=readUserVocabulary(store),catalog=combinedCatalog(user)
  let state=emptyLearningState(catalog,now)
  state.history[1000000]=recordAssessment(emptyWordHistory(),false,now)
  state.reviewSession=createReviewSession(catalog,state.history,now)
  const oldPractice=legacySession(state.reviewSession.practice)
  const old={...state,version:4,reviewSession:{version:1,practice:{...oldPractice,draft:'kesfetmek'}}}
  store.setItem(LEARNING_STATE_KEY,JSON.stringify(old))
  const changed=saveEditedWord(store,1000000,{english:'discover',turkishMeanings:['ortaya çıkarmak']})
  const loaded=loadLearningState(store,combinedCatalog(changed),now,legacyCatalog(changed)).value
  assert.deepEqual(loaded.history[1000000],state.history[1000000]);assert.deepEqual(loaded.activity,state.activity)
  assert.equal(loaded.reviewSession.practice.questions[0].snapshot.acceptedAnswers[0],'keşfetmek')
  loaded.reviewSession.practice=submitAnswer(loaded.reviewSession.practice)
  assert.equal(loaded.reviewSession.practice.submittedCorrect,true)
  const next=assessReviewState(loaded,true,now,catalog)
  assert.equal(next.history[1000000].englishToTurkish.timesKnown,1)
  assert.equal(store.getItem('kelime-favorites'),'[0,1000000]')
  const restored=parseReviewSession(next.reviewSession,catalog);assert.equal(restored.practice.results[0].correct,true)
  const d=dashboard(catalog,next.history,[0,1000000],next.activity,now);assert.equal(d.today,1)
})
