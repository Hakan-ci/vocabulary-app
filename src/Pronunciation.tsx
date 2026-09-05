import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { PronunciationController } from './pronunciationController'
import type { SpeakOptions } from './pronunciationController'
import { PronunciationContext, usePronunciation } from './pronunciationContext'
import type { PronunciationContextValue } from './pronunciationContext'

export function PronunciationProvider({ children, controller: supplied }: { children: React.ReactNode; controller?: PronunciationController }) {
  const [controller] = useState(() => supplied ?? new PronunciationController())
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [seen] = useState(() => new Set<string>())
  useEffect(() => () => { if (!supplied) controller.dispose() }, [controller, supplied])
  const autoSpeakOnce = useCallback((key: string, text: string, enabled: boolean, options?: Omit<SpeakOptions, 'key'>) => {
    if (seen.has(key)) return false
    seen.add(key)
    return enabled ? controller.speak(text, { ...options, key }) : false
  }, [controller, seen])
  const speak = useCallback((text: string, options?: SpeakOptions) => controller.speak(text, options), [controller])
  const stop = useCallback(() => controller.stop(), [controller])
  const value = useMemo<PronunciationContextValue>(() => ({
    ...snapshot,
    speak,
    stop,
    autoSpeakOnce,
  }), [snapshot, speak, stop, autoSpeakOnce])
  return <PronunciationContext.Provider value={value}>{children}</PronunciationContext.Provider>
}

function SpeakerIcon() {
  return <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M11 5 6.5 9H3v6h3.5l4.5 4V5Z"/><path d="M15 9a4 4 0 0 1 0 6M17.8 6.4a8 8 0 0 1 0 11.2"/></svg>
}

export function PronunciationButton({ text, speechKey, label, disabled = false, className = '' }: { text: string; speechKey: string; label?: string; disabled?: boolean; className?: string }) {
  const pronunciation = usePronunciation()
  if (!pronunciation.isSupported) return null
  const speaking = pronunciation.isSpeaking && pronunciation.currentKey === speechKey
  return <button type="button" className={`pronunciation-button ${speaking ? 'speaking' : ''} ${className}`.trim()} disabled={disabled || !text.trim()} aria-label={label ?? `Pronounce ${text.trim()}`} aria-pressed={speaking} onClick={() => pronunciation.speak(text, { key: speechKey })}><SpeakerIcon /></button>
}

export function AutoPronunciationSetting({ checked, onChange, compact = false }: { checked: boolean; onChange: (value: boolean) => void; compact?: boolean }) {
  const { isSupported, stop } = usePronunciation()
  return <div className={`pronunciation-setting ${compact ? 'compact' : ''}`}>
    <label><input type="checkbox" checked={checked} onChange={event => { if (!event.target.checked) stop(); onChange(event.target.checked) }} /><span><strong>Automatic pronunciation</strong>{!compact && <small>Hear English prompts and revealed answers during practice.</small>}</span></label>
    {!isSupported && <p className="pronunciation-unavailable" role="note">Pronunciation is not available on this device.</p>}
  </div>
}


