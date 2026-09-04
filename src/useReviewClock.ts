import { useEffect, useState } from 'react'

export function useReviewClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setNow(Date.now()) }
    const interval = window.setInterval(refresh, 60_000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(interval)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])
  return { now, refresh: () => { const at = Date.now(); setNow(at); return at } }
}
