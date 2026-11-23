import { useContext } from 'preact/hooks'
import { documentLanguages, LanguageContext, useMessages } from '../i18n'
import type { ProjectStats as Stats } from '../lib/statsStore'

const metrics = ['impression', 'detail', 'click'] as const

export function ProjectStats({ stats }: { stats: Stats }) {
  const { stats: t } = useMessages()
  const locale = documentLanguages[useContext(LanguageContext)]
  const number = new Intl.NumberFormat(locale)
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const height = 24
  const peak = Math.max(1, ...stats.daily.map(point => point.impressions))
  return <section class="project-stats" aria-label={t.label}>
    <table>
      <thead><tr>
        <td></td>
        <th scope="col" aria-label={t.lastDays(7)}>{t.days(7)}</th>
        <th scope="col" aria-label={t.lastDays(30)}>{t.days(30)}</th>
      </tr></thead>
      <tbody>{metrics.map(metric => <tr key={metric}>
        <th scope="row">{t[metric]}</th>
        <td><span>{number.format(stats.week[metric])}</span></td>
        <td><span>{number.format(stats.month[metric])}</span></td>
      </tr>)}</tbody>
    </table>
    <svg class="project-stats-chart" viewBox={`0 0 ${stats.daily.length * 8} ${height}`} preserveAspectRatio="none"
      role="img" aria-label={t.chart}>
      {stats.daily.map(({ day: date, impressions }, index) => {
        const size = impressions ? Math.max(2, impressions / peak * height) : 1
        return <rect key={date} x={index * 8} y={height - size} width="6" height={size} rx="1" data-empty={!impressions}>
          <title>{day.format(new Date(date))} · {number.format(impressions)}</title>
        </rect>
      })}
    </svg>
  </section>
}
