import test from 'node:test'
import assert from 'node:assert/strict'
import { words } from '../src/vocabulary.ts'
import { parseVocabulary, classifyPreview, englishKey } from '../src/vocabularyImport.ts'
import { parseUserVocabulary, saveImportedWords, readUserVocabulary, USER_VOCABULARY_KEY } from '../src/userVocabulary.ts'
import { emptyHistory, parseHistory, recordAssessment, calculatedWord } from '../src/learningHistory.ts'
import { createSession, questionContent, submitAnswer, assessAnswer, sessionSummary, parseSession, sanitizeIds } from '../src/dailyTestModel.ts'
import { loadLearningState, LEARNING_STATE_KEY } from '../src/learningState.ts'

const storage = () => {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}
test('parser handles delimiters, phrases, hyphenated words, optional POS and whitespace', () => {
  const rows = parseVocabulary('  \r\napple - elma\r\ngood   evening\tiyi akşamlar\tphrase\nwell-known - tanınmış - adjective\ndiscover keşfetmek\nbook\tkitap\n')
  assert.equal(rows.length, 5)
  assert.deepEqual(rows.map(r => r.entry), [
    { tags: [], english: 'apple', turkishMeanings: ['elma'] }, { tags: [], english: 'good evening', turkishMeanings: ['iyi akşamlar'], partOfSpeech: 'phrase' },
    { tags: [], english: 'well-known', turkishMeanings: ['tanınmış'], partOfSpeech: 'adjective' }, { tags: [], english: 'discover', turkishMeanings: ['keşfetmek'] }, { tags: [], english: 'book', turkishMeanings: ['kitap'] },
  ])
})
test('malformed nonblank rows remain invalid, including empty columns and ambiguous spaces', () => {
  const text = ['one', 'too many tokens', 'apple - ', '- elma', '\telma', 'apple\t', 'apple - elma - noun - extra - fifth', 'apple\telma\tnoun\textra\tfifth'].join('\n')
  const rows = classifyPreview(parseVocabulary(text), words)
  assert.equal(rows.length, 8)
  assert.ok(rows.every(r => r.status === 'Invalid' && r.error && r.source))
})
test('duplicate English keys use NFC and casing, and removal promotes the next occurrence', () => {
  const rows = parseVocabulary('APPLE - başka\nDiscover - keşfetmek\ndiscover - bulmak - verb\ncafé - kafe\ncafé - kahve\ncafe - kahve')
  assert.deepEqual(classifyPreview(rows, words).map(r => r.status), ['Merge','Ready','Merge','Ready','Merge','Ready'])
  assert.equal(classifyPreview(rows.filter(r => r.id !== 1), words)[1].status, 'Ready')
  assert.equal(englishKey('  GOOD   Evening '), 'good evening')
  assert.notEqual(englishKey('café'), englishKey('cafe'))
})
test('imports retain stable IDs, revalidate at save, persist separately, and safely retry failures', () => {
  const store = storage(), rows = parseVocabulary('discover - keşfetmek\nexplore - araştırmak\nAPPLE - elma\nbad')
  const first = saveImportedWords(store, rows)
  assert.deepEqual(first.added.map(w => w.id), [1000000,1000001])
  assert.equal(first.value.nextId, 1000002)
  assert.deepEqual(readUserVocabulary(store), first.value)
  assert.equal(saveImportedWords(store, rows).added.length, 0)
  const next = parseVocabulary('commute - işe gidip gelmek')
  assert.throws(() => saveImportedWords({ getItem: store.getItem, setItem() { throw Error('quota') } }, next))
  assert.deepEqual(readUserVocabulary(store), first.value)
  assert.equal(saveImportedWords(store, next).added[0].id, 1000002)
  assert.throws(() => saveImportedWords({ getItem() { throw Error('blocked') }, setItem() {} }, next))
  assert.equal(words.length, 150)
})
test('stored data validation retains sense IDs and preserves the next-ID high-water mark', () => {
  const result = parseUserVocabulary({ version: 1, nextId: 1000050, entries: [
    { id: 1000000, english: 'Apple', turkish: 'elma' },
    { id: 1000001, english: ' discover ', turkish: ' keşfetmek ', type: ' verb ' },
    { id: 1000001, english: 'other', turkish: 'diğer' },
    { id: 1000002, english: 'DISCOVER', turkish: 'bulmak' },
    { id: 1000003, english: '', turkish: 'boş' },
    { id: 0, english: 'invalid', turkish: 'yanlış' }, null,
  ] })
  assert.deepEqual(result.entries.map(w => w.id), [1000000,1000001,1000002])
  assert.deepEqual(result.entries[1].turkishMeanings, ['keşfetmek'])
  assert.equal(result.entries[1].partOfSpeech, 'verb')
  assert.equal(result.nextId, 1000050)
  const store = storage(); store.setItem(USER_VOCABULARY_KEY, '{bad')
  assert.deepEqual(readUserVocabulary(store).entries, [])
})
test('new history is empty and existing history/session/preferences remain intact after import', () => {
  const store = storage(), initial = loadLearningState(store).value
  initial.history[0] = recordAssessment(initial.history[0], true, 100)
  initial.preferredMode = 'mixed'
  initial.session = { ...createSession(initial.history), draft: 'pending' }
  store.setItem(LEARNING_STATE_KEY, JSON.stringify(initial))
  const imported = saveImportedWords(store, parseVocabulary('discover - keşfetmek')).added
  const catalog = [...words, ...imported], loaded = loadLearningState(store, catalog).value
  assert.deepEqual(loaded.session, initial.session)
  assert.equal(loaded.preferredMode, 'mixed')
  assert.deepEqual(loaded.history[0], initial.history[0])
  assert.equal(loaded.history[1000000].timesTested, 0)
  assert.equal(loaded.history[1000000].learned, false)
  assert.equal(calculatedWord(loaded.history[1000000], 100).difficulty.level, 'New')
  assert.deepEqual(sanitizeIds([0,1000000,1000000,9999999], catalog), [0,1000000])
})
test('imported questions work in every mode, restore through feedback/completion and produce summaries', () => {
  const store = storage()
  const catalog = saveImportedWords(store, parseVocabulary(Array.from({length:10}, (_, i) => `custom${i} - özel${i}`).join('\n'))).added
  for (const mode of ['englishToTurkish','turkishToEnglish','mixed']) {
    let history = emptyHistory(catalog), session = createSession(history, 1000, () => .6, mode, [], catalog)
    assert.equal(session.questions.length, 10)
    for (let i = 0; i < 10; i++) {
      const content = questionContent(session.questions[i], catalog)
      session = submitAnswer({ ...session, draft: content.expected })
      assert.deepEqual(parseSession(session, [...words, ...catalog]), session)
      const next = assessAnswer(session, history, true, 1000 + i)
      history = next.history; session = next.session
    }
    assert.equal(sessionSummary(session, catalog).score, 10)
    assert.equal(sessionSummary(session, catalog).newlyLearned, 10)
    assert.deepEqual(parseSession(session, [...words, ...catalog]), session)
    assert.deepEqual(parseHistory(history, false, catalog), history)
    store.setItem(LEARNING_STATE_KEY, JSON.stringify({version:2, preferredMode:mode, history, session}))
    assert.deepEqual(loadLearningState(store, [...words,...catalog]).value.session, session)
  }
})
