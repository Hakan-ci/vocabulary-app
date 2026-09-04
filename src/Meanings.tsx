import type { VocabularyWord } from './vocabulary'
export function Meanings({ word }: { word: VocabularyWord }) {
  return word.turkishMeanings.length > 1 ? <details className="extra-meanings"><summary>+{word.turkishMeanings.length-1} meanings</summary><ul lang="tr">{word.turkishMeanings.map(m => <li key={m}>{m}</li>)}</ul></details> : null
}
