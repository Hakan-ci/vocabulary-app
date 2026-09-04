import { modeLabels, isTestMode } from './learningTypes'
import type { TestMode } from './learningTypes'
export function DirectionSetting({ mode, onChange }: { mode: TestMode; onChange: (mode: TestMode) => void }) {
  return <label className="direction-setting">Test direction
    <select aria-label="Test direction" value={mode} onChange={event => { if (isTestMode(event.target.value)) onChange(event.target.value) }}>
      {Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </label>
}
