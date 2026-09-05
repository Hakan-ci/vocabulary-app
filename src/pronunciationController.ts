export type SpeakOptions = { language?: string; rate?: number; key?: string }

export type SpeechVoice = { lang: string; default?: boolean }
export type SpeechUtterance = {
  text: string
  lang: string
  rate: number
  voice: SpeechVoice | null
  onstart: (() => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}
export type SpeechAdapter = {
  createUtterance(text: string): SpeechUtterance
  getVoices(): SpeechVoice[]
  speak(utterance: SpeechUtterance): void
  cancel(): void
  addVoicesChanged(listener: () => void): void
  removeVoicesChanged(listener: () => void): void
}
export type PronunciationSnapshot = { isSupported: boolean; isSpeaking: boolean; currentKey: string | null }

export function selectVoice(voices: readonly SpeechVoice[], language = 'en-US'): SpeechVoice | undefined {
  const normalized = language.toLowerCase()
  return voices.find(voice => voice.lang.toLowerCase() === normalized)
    ?? voices.find(voice => voice.lang.toLowerCase().startsWith('en'))
    ?? voices.find(voice => voice.default)
    ?? voices[0]
}

export function browserSpeechAdapter(): SpeechAdapter | null {
  if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return null
  const synthesis = window.speechSynthesis
  return {
    createUtterance(text) { return new SpeechSynthesisUtterance(text) as SpeechUtterance },
    getVoices: () => synthesis.getVoices() as SpeechVoice[],
    speak: utterance => synthesis.speak(utterance as SpeechSynthesisUtterance),
    cancel: () => synthesis.cancel(),
    addVoicesChanged: listener => synthesis.addEventListener('voiceschanged', listener),
    removeVoicesChanged: listener => synthesis.removeEventListener('voiceschanged', listener),
  }
}

export class PronunciationController {
  private listeners = new Set<() => void>()
  private request = 0
  private voices: SpeechVoice[] = []
  private snapshot: PronunciationSnapshot
  private readonly onVoicesChanged = () => { this.voices = this.adapter?.getVoices() ?? [] }

  private readonly adapter: SpeechAdapter | null
  constructor(adapter: SpeechAdapter | null = browserSpeechAdapter()) {
    this.adapter = adapter
    this.snapshot = { isSupported: !!adapter, isSpeaking: false, currentKey: null }
    if (adapter) {
      this.voices = adapter.getVoices()
      adapter.addVoicesChanged(this.onVoicesChanged)
    }
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getSnapshot = () => this.snapshot
  private update(next: PronunciationSnapshot) {
    if (this.snapshot.isSupported === next.isSupported && this.snapshot.isSpeaking === next.isSpeaking && this.snapshot.currentKey === next.currentKey) return
    this.snapshot = next; for (const listener of this.listeners) listener()
  }

  speak(text: string, options: SpeakOptions = {}): boolean {
    const value = text.trim()
    if (!this.adapter || !value) return false
    const request = ++this.request
    this.adapter.cancel()
    const language = options.language ?? 'en-US'
    const utterance = this.adapter.createUtterance(value)
    utterance.lang = language
    utterance.rate = options.rate ?? 1
    utterance.voice = selectVoice(this.voices, language) ?? null
    const key = options.key ?? value
    utterance.onstart = () => { if (request === this.request) this.update({ isSupported: true, isSpeaking: true, currentKey: key }) }
    const finish = () => { if (request === this.request) this.update({ isSupported: true, isSpeaking: false, currentKey: null }) }
    utterance.onend = finish
    utterance.onerror = finish
    this.update({ isSupported: true, isSpeaking: false, currentKey: key })
    try { this.adapter.speak(utterance); return true }
    catch { finish(); return false }
  }

  stop() {
    if (!this.adapter) return
    ++this.request
    this.adapter.cancel()
    this.update({ isSupported: true, isSpeaking: false, currentKey: null })
  }

  dispose() {
    this.stop()
    this.adapter?.removeVoicesChanged(this.onVoicesChanged)
    this.listeners.clear()
  }
}
