export interface WorkConfig {
  lunchBreakMinutes: number;
}

export const WORKDAY_HOURS = 8;

/** 加班不足该分钟数时整天不计 */
const MIN_OVERTIME_MINUTES = 60;

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function fmtDuration(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export interface DayStat {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
  workedMinutes: number;
  overtimeMinutes: number;
  otStartMinutes: number | null;
  incomplete: boolean;
}

export interface Summary {
  days: DayStat[];
  workedDays: number;
  totalWorkedMinutes: number;
  avgWorkedMinutes: number;
  overtimeDays: number;
  totalOvertimeMinutes: number;
}

function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function computeDay(
  rec: { date: string; clockIn: string | null; clockOut: string | null },
  work: WorkConfig,
): DayStat {
  const incomplete = !rec.clockIn || !rec.clockOut;
  const wd = weekdayOf(rec.date);
  const isWeekend = wd === 0 || wd === 6;

  let workedMinutes = 0;
  if (rec.clockIn && rec.clockOut) {
    const span = Math.max(timeToMinutes(rec.clockOut) - timeToMinutes(rec.clockIn), 0);
    workedMinutes = Math.max(span - work.lunchBreakMinutes, 0);
  }

  let overtimeMinutes = 0;
  let otStartMinutes: number | null = null;
  if (rec.clockIn && rec.clockOut) {
    if (isWeekend) {
      overtimeMinutes = Math.min(workedMinutes, WORKDAY_HOURS * 60);
      otStartMinutes = timeToMinutes(rec.clockIn);
    } else if (workedMinutes > WORKDAY_HOURS * 60) {
      overtimeMinutes = workedMinutes - WORKDAY_HOURS * 60;
      otStartMinutes = timeToMinutes(rec.clockOut) - overtimeMinutes;
    }
  }
  if (otStartMinutes !== null && rec.clockIn) {
    otStartMinutes = Math.max(otStartMinutes, timeToMinutes(rec.clockIn));
  }
  if (overtimeMinutes < MIN_OVERTIME_MINUTES) {
    overtimeMinutes = 0;
    otStartMinutes = null;
  }
  return {
    date: rec.date,
    clockIn: rec.clockIn,
    clockOut: rec.clockOut,
    workedMinutes,
    overtimeMinutes,
    otStartMinutes,
    incomplete,
  };
}

export function summarize(
  records: Array<{ date: string; clockIn: string | null; clockOut: string | null }>,
  work: WorkConfig,
): Summary {
  const sorted = [...records].sort((a, b) => a.date.localeCompare(b.date));
  const days = sorted.map((r) => computeDay(r, work));
  const worked = days.filter((d) => !d.incomplete);
  const overtimeDays = days.filter((d) => d.overtimeMinutes > 0);

  const totalWorkedMinutes = worked.reduce((s, d) => s + d.workedMinutes, 0);
  const totalOvertimeMinutes = overtimeDays.reduce((s, d) => s + d.overtimeMinutes, 0);

  return {
    days,
    workedDays: worked.length,
    totalWorkedMinutes,
    avgWorkedMinutes: worked.length ? Math.round(totalWorkedMinutes / worked.length) : 0,
    overtimeDays: overtimeDays.length,
    totalOvertimeMinutes,
  };
}

/** 叠加每日手工修正（单位分钟，可为负），只影响加班时长，工时不动 */
export function withDayAdjustments(summary: Summary, adjust: Record<string, number>): Summary {
  let changed = false;
  const days = summary.days.map((d) => {
    const delta = adjust[d.date] ?? 0;
    if (delta === 0) return d;
    changed = true;
    return { ...d, overtimeMinutes: d.overtimeMinutes + delta };
  });
  if (!changed) return summary;
  return {
    ...summary,
    days,
    overtimeDays: days.filter((d) => d.overtimeMinutes > 0).length,
    totalOvertimeMinutes: days.reduce((s, d) => s + d.overtimeMinutes, 0),
  };
}

export function monthKey(date: string): string {
  return date.slice(0, 7);
}

export interface MonthGroup {
  key: string;
  label: string;
  summary: Summary;
}

export function summarizeByMonth(
  records: Array<{ date: string; clockIn: string | null; clockOut: string | null }>,
  work: WorkConfig,
): { total: Summary; months: MonthGroup[] } {
  const total = summarize(records, work);

  const byMonth = new Map<string, Array<{ date: string; clockIn: string | null; clockOut: string | null }>>();
  for (const r of records) {
    const key = monthKey(r.date);
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(r);
  }

  const months = [...byMonth.entries()]
    .map(([key, recs]) => {
      const y = key.slice(0, 4);
      const m = Number(key.slice(5, 7));
      return { key, label: `${y}年${m}月`, summary: summarize(recs, work) };
    })
    .sort((a, b) => b.key.localeCompare(a.key));

  return { total, months };
}
