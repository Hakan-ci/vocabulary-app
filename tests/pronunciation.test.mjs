import test from 'node:test'
import assert from 'node:assert/strict'
import { PronunciationController, selectVoice } from '../src/pronunciationController.ts'
import { emptyLearningState, parseLearningState } from '../src/learningState.ts'
import { decodeData, encodeData, emptyIdentities } from '../src/data/codec.ts'
import { emptyCache, parseCache, SyncService } from '../src/data/syncService.ts'
import { memoryStorage } from '../src/data/localRepository.ts'

function adapter(voices=[]) {
  const spoken=[],listeners=new Set()
  return {
    spoken, listeners, cancelled:0, voices,
    createUtterance(text){return {text,lang:'',rate:1,voice:null,onstart:null,onend:null,onerror:null}},
    getVoices(){return this.voices},
    speak(utterance){spoken.push(utterance)},
    cancel(){this.cancelled++},
    addVoicesChanged(listener){listeners.add(listener)},
    removeVoicesChanged(listener){listeners.delete(listener)},
  }
}

test('voice selection follows exact English, English, default, first, and browser fallback priority',()=>{
  const first={lang:'tr-TR'},fallback={lang:'de-DE',default:true},english={lang:'en-GB'},exact={lang:'en-US'}
  assert.equal(selectVoice([first,fallback,english,exact]),exact)
  assert.equal(selectVoice([first,fallback,english]),english)
  assert.equal(selectVoice([first,fallback]),fallback)
  assert.equal(selectVoice([first]),first)
  assert.equal(selectVoice([]),undefined)
})

test('controller speaks complete phrases with injected language/rate and reloads voices',()=>{
  const fake=adapter([{lang:'en-GB'}]),controller=new PronunciationController(fake)
  assert.equal(fake.listeners.size,1)
  assert.equal(controller.speak('  find out  ',{language:'en-US',rate:.8,key:'phrase'}),true)
  const utterance=fake.spoken[0]
  assert.equal(utterance.text,'find out');assert.equal(utterance.lang,'en-US');assert.equal(utterance.rate,.8);assert.equal(utterance.voice.lang,'en-GB')
  utterance.onstart();assert.deepEqual(controller.getSnapshot(),{isSupported:true,isSpeaking:true,currentKey:'phrase'})
  fake.voices=[{lang:'en-US'}];for(const listener of fake.listeners)listener()
  controller.speak('run',{key:'run'});assert.equal(fake.spoken[1].voice.lang,'en-US');assert.equal(fake.cancelled,2)
  controller.dispose();assert.equal(fake.listeners.size,0)
})

test('replay cancels current speech and stale callbacks cannot corrupt current state',()=>{
  const fake=adapter(),controller=new PronunciationController(fake)
  controller.speak('first',{key:'first'});const first=fake.spoken[0];first.onstart()
  controller.speak('second',{key:'second'});const second=fake.spoken[1];second.onstart()
  first.onend();assert.deepEqual(controller.getSnapshot(),{isSupported:true,isSpeaking:true,currentKey:'second'})
  second.onerror();assert.deepEqual(controller.getSnapshot(),{isSupported:true,isSpeaking:false,currentKey:null})
  assert.equal(fake.cancelled,2)
})

test('unsupported and empty speech requests remain non-blocking',()=>{
  const unsupported=new PronunciationController(null)
  assert.equal(unsupported.speak('hello'),false);assert.equal(unsupported.getSnapshot().isSupported,false)
  const fake=adapter(),supported=new PronunciationController(fake)
  assert.equal(supported.speak('   '),false);assert.equal(fake.spoken.length,0)
})

test('learning state defaults and migrates automatic pronunciation without affecting progress',()=>{
  const fresh=emptyLearningState();assert.equal(fresh.autoPronunciation,true);assert.equal(fresh.version,6)
  const old={...fresh,version:5};delete old.autoPronunciation
  assert.equal(parseLearningState(old).autoPronunciation,true)
  const disabled=parseLearningState({...fresh,autoPronunciation:false});assert.equal(disabled.autoPronunciation,false)
  const map=emptyIdentities(),cells=encodeData({vocabulary:{version:3,entries:[],overrides:{},suppressedBuiltinIds:[],hiddenBuiltinIds:[],hiddenBuiltinState:{},deletedIds:[],nextId:1_000_000},favorites:[],learning:disabled},map)
  assert.equal(cells['setting/auto-pronunciation'],false);assert.equal(decodeData(cells,map).learning.autoPronunciation,false)
})

test('account caches migrate to protocol 4 and new preference operations use protocol 4',()=>{
  const legacy={...emptyCache(),version:3};const migrated=parseCache(JSON.stringify(legacy));assert.equal(migrated.version,4)
  const storage=memoryStorage(),transport={pull:async()=>({revision:0,cells:{}}),push:async operation=>({conflict:false,snapshot:{revision:1,cells:Object.fromEntries(operation.changes.map(c=>[c.key,c.after]))}})}
  const sync=new SyncService(storage,'pronunciation',transport);sync.setOnline(false);sync.enqueue('preferences',{}, {'setting/auto-pronunciation':false})
  assert.equal(sync.cache.queue[0].protocol,4);sync.dispose()
})
