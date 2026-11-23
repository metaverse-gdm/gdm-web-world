import { CLOCK_SKEW_MS, DAY_MS } from './delegation'

export const STATS_RETENTION_DAYS = 90
export const utcDay = (at: number) => new Date(at).toISOString().slice(0, 10)
export const utcDayStart = (at: number) => Math.floor(at / DAY_MS) * DAY_MS

export function parseStatsDay(day: unknown): number {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NaN
  const at = Date.parse(day)
  return Number.isFinite(at) && utcDay(at) === day ? at : NaN
}

export function retainedStatsDay(day: string, now: number) {
  const at = parseStatsDay(day)
  return at >= utcDayStart(now) - (STATS_RETENTION_DAYS - 1) * DAY_MS && at <= now + CLOCK_SKEW_MS
}
