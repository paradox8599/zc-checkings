export interface WorkConfig {
  standardStart: string;
  standardEnd: string;
  overtimeBufferMinutes: number;
  overtimeFrom: "threshold" | "standard" | "8hours";
  lunchBreakMinutes: number;
  weekendLunchBreak: boolean;
  minOvertimeMinutes: number;
}

export const WORKDAY_HOURS = 8;

export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function fmtDuration(min: number): string {
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${h}h ${m}m`;
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
  let workedMinutes = 0;
  if (rec.clockIn && rec.clockOut) {
    const inT = timeToMinutes(rec.clockIn);
    const outT = timeToMinutes(rec.clockOut);
    workedMinutes = outT - inT - work.lunchBreakMinutes;
    if (workedMinutes < 0) workedMinutes = 0;
  }
  const incomplete = !rec.clockIn || !rec.clockOut;
  let overtimeMinutes = 0;
  let otStartMinutes: number | null = null;
  const wd = weekdayOf(rec.date);
  if (wd === 0 || wd === 6) {
    if (rec.clockIn && rec.clockOut) {
      if (!work.weekendLunchBreak) workedMinutes = workedMinutes + work.lunchBreakMinutes;
      overtimeMinutes = Math.max(workedMinutes, 0);
      otStartMinutes = timeToMinutes(rec.clockIn);
    }
  } else if (work.overtimeFrom === "8hours") {
    if (workedMinutes > WORKDAY_HOURS * 60) {
      overtimeMinutes = workedMinutes - WORKDAY_HOURS * 60;
      if (rec.clockOut) otStartMinutes = timeToMinutes(rec.clockOut) - overtimeMinutes;
    }
  } else if (rec.clockOut) {
    const out = timeToMinutes(rec.clockOut);
    const end = timeToMinutes(work.standardEnd);
    const threshold = end + work.overtimeBufferMinutes;
    if (out > threshold) {
      const start = work.overtimeFrom === "threshold" ? threshold : end;
      overtimeMinutes = out - start;
      otStartMinutes = start;
    }
  }
  if (otStartMinutes !== null && rec.clockIn) {
    otStartMinutes = Math.max(otStartMinutes, timeToMinutes(rec.clockIn));
  }
  if (overtimeMinutes < work.minOvertimeMinutes) {
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
