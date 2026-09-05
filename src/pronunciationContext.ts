import { createContext, useContext } from 'react'
import type { SpeakOptions } from './pronunciationController'

export type PronunciationContextValue = {
  speak(text: string, options?: SpeakOptions): boolean
  autoSpeakOnce(key: string, text: string, enabled: boolean, options?: Omit<SpeakOptions, 'key'>): boolean
  stop(): void
  isSupported: boolean
  isSpeaking: boolean
  currentKey: string | null
}

export const PronunciationContext = createContext<PronunciationContextValue | null>(null)

export function usePronunciation() {
  const value = useContext(PronunciationContext)
  if (!value) throw Error('usePronunciation must be used inside PronunciationProvider.')
  return value
}
