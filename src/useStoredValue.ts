import { useRef, useState } from 'react'

// Writes happen in event handlers; the ref also prevents repeated events using stale state.
export function useStoredValue<T>(key: string, parse: (value: unknown) => T, load?: () => { value: T; error: boolean }) {
  const [initial] = useState(() => {
    if (load) return load()
    try {
      const raw = localStorage.getItem(key)
      try { return { value: parse(raw === null ? null : JSON.parse(raw)), error: false } }
      catch { return { value: parse(null), error: false } }
    } catch { return { value: parse(null), error: true } }
  })
  const [value, setValue] = useState(initial.value)
  const [error, setError] = useState(initial.error)
  const current = useRef(value)
  function save(next: T) {
    current.current = next
    setValue(next)
    try { localStorage.setItem(key, JSON.stringify(next)); setError(false) }
    catch { setError(true) }
  }
  return { value, current, save, error }
}
