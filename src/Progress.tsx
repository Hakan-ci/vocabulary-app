import { primaryMeaning } from './wordFields'
import type { Dashboard } from './progressModel'
import { percentage } from './progressModel'
import { goals } from './activity'
import { modeLabels } from './learningTypes'
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value)}%`
const decimal = (value: number | null) => value === null ? '—' : value.toFixed(1)
const displayDate = (key: string) => { const [y,m,d] = key.split('-').map(Number); return new Date(y,m-1,d).toLocaleDateString(undefined, {month:'short',day:'numeric'}) }
function Metrics({ items }: { items: [string, string | number][] }) {
  return <dl className="progress-metrics">{items.map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}
function ActivityChart({ days, accuracyChart = false }: { days: Dashboard['days']; accuracyChart?: boolean }) {
  const max = accuracyChart ? 100 : Math.max(1, ...days.map(d => d.answered))
  return <section className="activity-chart" aria-label={accuracyChart ? 'Daily accuracy chart' : 'Daily questions chart'}>
    <h3>{accuracyChart ? 'Accuracy by day' : 'Questions answered per day'}</h3>
    <div className="chart-columns">{days.map(day => {
      const value = day.available ? accuracyChart ? day.accuracy : day.answered : null
      return <div className="chart-column" key={day.date} aria-label={`${day.date}: ${value === null ? 'unavailable' : accuracyChart ? percent(value) : value}`}>
        <span className="chart-value">{value === null ? '—' : accuracyChart ? percent(value) : value}</span>
        <div className="chart-track"><div className="chart-bar" style={{height:`${value === null ? 0 : value / max * 100}%`}} /></div>
        <time dateTime={day.date}>{displayDate(day.date)}</time>
      </div>
    })}</div>
  </section>
}
export function Progress({ data, goal, onGoal, onReview }: { data: Dashboard; goal: number; onGoal: (goal: number) => void; onReview: () => void }) {
  return <div className="progress-page">
    <section className="dashboard-panel"><h2>Your vocabulary at a glance</h2>
      <Metrics items={[["Total vocabulary",data.total],["New words",data.newWords],["Learning words",data.learning],["Learned words",data.learned],["Needs Review words",data.needsReview],["Favorite words",data.favorites],["Scheduled today",data.scheduledToday]]} />
      <div className="membership-progress">{([['Learning',data.learning],['Learned',data.learned],['Needs Review',data.needsReview]] as const).map(([label,value]) => <div key={label}><label>{label}: {value} / {data.total} <strong>{percentage(value,data.total)}%</strong></label><progress aria-label={`${label} percentage`} max={100} value={percentage(value,data.total)} /></div>)}</div>
      <p className="test-hint">Needs Review can overlap Learned or Learning. Scheduled today includes deadlines later today; older overdue words appear in Needs Attention.</p>
    </section>
    <div className="dashboard-grid">
      <section className="dashboard-panel"><h2>Daily goal</h2><label className="goal-setting" htmlFor="daily-goal">Questions per day<select id="daily-goal" value={goal} onChange={e => onGoal(Number(e.target.value))}>{goals.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        <p className="goal-total" role="status">{data.today} / {goal} <span>{data.today >= goal ? 'Goal completed' : 'Keep going, one question at a time.'}</span></p>
        <progress aria-label="Daily goal progress" max={goal} value={Math.min(goal,data.today)} /><p className="test-hint">Daily Test and Review questions count after self-assessment.</p>
      </section>
      <section className="dashboard-panel"><h2>Your study rhythm</h2><Metrics items={[["Current streak",data.streak.current],["Best streak",data.streak.best],["Last study date",data.streak.last ?? '—']]} /><p className="test-hint">Complete a Daily Test or Review to count a study day. {data.streak.current ? 'Every small session adds up.' : 'A new streak can begin whenever you’re ready.'}</p></section>
    </div>
    <section className="dashboard-panel"><h2>Daily Test statistics</h2><Metrics items={[["Recorded tests completed",data.daily.completed],["Questions assessed",data.daily.answered],["Overall accuracy",percent(data.daily.accuracy)],["Average score",data.daily.average === null ? '—' : `${decimal(data.daily.average)} / 10`],["Best score",data.daily.best === null ? '—' : `${data.daily.best} / 10`]]} />
      <p className="test-hint">Statistics include recoverable saved results and new activity. Older overwritten tests cannot be reconstructed. Accuracy includes assessed questions from unfinished tests; scores use completed tests.</p>
    </section>
    <section className="dashboard-panel"><h2>Directional performance</h2><p className="weaker-direction">Weaker direction: {data.weaker}</p><div className="dashboard-grid">{data.directional.map(d => <div key={d.direction}><h3>{modeLabels[d.direction]}</h3><Metrics items={[["Lifetime questions assessed",d.answered],["Recorded typed accuracy",percent(d.accuracy)],["Average difficulty",d.difficulty === null ? '—' : `${decimal(d.difficulty)} / 100`]]} /><p className="test-hint">Accuracy covers {d.recorded} recorded answers. Difficulty averages tested words in this direction.</p></div>)}</div><p className="test-hint">Both Daily Test and Review are included. Lifetime counts may cover more history than saved typed answers. The weaker direction combines accuracy and current difficulty equally.</p></section>
    <section className="dashboard-panel"><h2>Last 7 days</h2><p className="test-hint">Dated tracking begins with this update. Earlier unavailable days show —; the first tracked day may be partial. Older recovered answers have no dates and do not count toward charts, goals, or streaks.</p>
      <div className="dashboard-grid"><ActivityChart days={data.days} /><ActivityChart days={data.days} accuracyChart /></div>
      <div className="activity-table-scroll" tabIndex={0} role="region" aria-label="Seven-day activity table"><table className="activity-table"><caption>Daily Test and Review activity</caption><thead><tr><th>Date</th><th>Questions</th><th>Known</th><th>Missed</th><th>Accuracy</th></tr></thead><tbody>{data.days.map(day => <tr key={day.date}><th scope="row"><time dateTime={day.date}>{displayDate(day.date)}</time></th><td>{day.available ? day.answered : '—'}</td><td>{day.available ? day.known : '—'}</td><td>{day.available ? day.missed : '—'}</td><td>{percent(day.accuracy)}</td></tr>)}</tbody></table></div>
    </section>
    <section className="dashboard-panel"><div className="section-heading"><h2>Needs Attention</h2><button className="secondary-button" onClick={onReview}>Open Review</button></div>
      {data.attention.length ? <ul className="attention-list">{data.attention.map(row => <li key={row.word.id}><div><strong>{row.word.english}</strong><span lang="tr">{primaryMeaning(row.word)}</span></div><div className="attention-reasons">{row.needsReview && <span>Needs Review</span>}{row.overdue && <span>Overdue</span>}{row.difficulty.score > 50 && <span>High difficulty</span>}{row.history.timesMissed >= 2 && <span>Missed {row.history.timesMissed} times</span>}</div></li>)}</ul> : <p className="test-hint">No words need extra attention right now.</p>}
    </section>
    <section className="hardest-section"><h2>Hardest Words</h2>{data.hardest.length ? <div className="word-grid">{data.hardest.map(row => <article className="word-card" key={row.word.id}><div className="card-top"><span className="topic-tag">{row.status}</span></div><h3>{row.word.english}</h3><p className="word-translation" lang="tr">{primaryMeaning(row.word)}</p><dl className="hardest-details"><div><dt>Overall</dt><dd>{row.difficulty.level} · {row.difficulty.score}/100</dd></div><div><dt>EN→TR</dt><dd>{row.englishToTurkish.level}{row.englishToTurkish.level !== 'New' && ` · ${row.englishToTurkish.score}/100`}</dd></div><div><dt>TR→EN</dt><dd>{row.turkishToEnglish.level}{row.turkishToEnglish.level !== 'New' && ` · ${row.turkishToEnglish.score}/100`}</dd></div><div><dt>Times missed</dt><dd>{row.history.timesMissed}</dd></div></dl></article>)}</div> : <p className="test-hint">Practice some words to see their difficulty here.</p>}</section>
  </div>
}
