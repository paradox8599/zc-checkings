import { type AttendanceRecord } from "./dom";
import { fetchMonthAttendances } from "./api";
import { summarizeByMonth, type WorkConfig } from "./calc";
import { createPanel } from "./panel";

const RECORDS_KEY = "zc-attendance-records";
const WORK_KEY = "zc-attendance-work";

const DEFAULT_WORK: WorkConfig = {
  standardStart: "08:30",
  standardEnd: "17:30",
  overtimeBufferMinutes: 30,
  overtimeFrom: "threshold",
  lunchBreakMinutes: 0,
};

function loadWork(): WorkConfig {
  try {
    const stored = GM_getValue(WORK_KEY, "");
    if (!stored) return structuredClone(DEFAULT_WORK);
    return { ...DEFAULT_WORK, ...JSON.parse(stored) };
  } catch {
    return structuredClone(DEFAULT_WORK);
  }
}

function loadRecords(): Map<string, AttendanceRecord> {
  const map = new Map<string, AttendanceRecord>();
  try {
    const stored = GM_getValue(RECORDS_KEY, "");
    if (!stored) return map;
    const arr = JSON.parse(stored);
    if (!Array.isArray(arr)) return map;
    for (const r of arr) {
      if (r && typeof r.date === "string") {
        map.set(r.date, {
          date: r.date,
          clockIn: r.clockIn ?? null,
          clockOut: r.clockOut ?? null,
        });
      }
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return map;
}

let work: WorkConfig = loadWork();
const records = loadRecords();
const captureLog: Array<{ url: string; count: number; time: string; source: string }> = [];
let apiFetching = false;

const panel = createPanel(work, {
  onSaveWork(next: WorkConfig) {
    try {
      if (
        typeof next !== "object" ||
        next === null ||
        typeof next.standardStart !== "string" ||
        typeof next.standardEnd !== "string" ||
        !Number.isFinite(next.overtimeBufferMinutes) ||
        !Number.isFinite(next.lunchBreakMinutes) ||
        (next.overtimeFrom !== "threshold" && next.overtimeFrom !== "standard" && next.overtimeFrom !== "8hours")
      ) {
        throw new Error("配置格式不合法");
      }
      work = { ...DEFAULT_WORK, ...next };
      GM_setValue(WORK_KEY, JSON.stringify(work));
      recompute();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  },
  onApiFetchMonth(month: string) {
    fetchMonth(month);
  },
  onApiBackfill(fromMonth: string) {
    backfillMonths(fromMonth);
  },
  onExport(all: AttendanceRecord[]) {
    if (all.length === 0) return;
    const lines = ["date,clockIn,clockOut"];
    for (const r of all) {
      lines.push(`${r.date},${r.clockIn ?? ""},${r.clockOut ?? ""}`);
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `attendance-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  onClear() {
    records.clear();
    persist();
    recompute();
  },
});

function persist(): void {
  GM_setValue(
    RECORDS_KEY,
    JSON.stringify(
      [...records.values()].map(({ date, clockIn, clockOut }) => ({ date, clockIn, clockOut })),
    ),
  );
}

function recompute(): void {
  const { total, months } = summarizeByMonth([...records.values()], work);
  panel.update(total, months, [...records.values()], captureLog);
}

function mergeRecords(parsed: AttendanceRecord[]): boolean {
  if (parsed.length === 0) return false;
  const month = parsed[0].date.slice(0, 7);
  const hasAnyClock = parsed.some((r) => r.clockIn || r.clockOut);
  let changed = false;
  if (!hasAnyClock) {
    for (const key of [...records.keys()]) {
      if (key.startsWith(month)) {
        records.delete(key);
        changed = true;
      }
    }
  } else {
    for (const rec of parsed) {
      const prev = records.get(rec.date);
      if (!prev) {
        records.set(rec.date, rec);
        changed = true;
        continue;
      }
      const clockIn = rec.clockIn ?? prev.clockIn;
      const clockOut = rec.clockOut ?? prev.clockOut;
      if (clockIn !== prev.clockIn || clockOut !== prev.clockOut) {
        records.set(rec.date, { date: rec.date, clockIn, clockOut });
        changed = true;
      }
    }
  }
  if (changed) {
    persist();
  }
  return changed;
}

async function fetchMonth(yearMonth: string): Promise<boolean> {
  if (apiFetching) return false;
  apiFetching = true;
  try {
    const parsed = await fetchMonthAttendances(yearMonth);
    const hasClock = parsed.some((r) => r.clockIn || r.clockOut);
    captureLog.push({ url: `api:${yearMonth}`, count: parsed.length, time: new Date().toLocaleTimeString(), source: "api" });
    if (captureLog.length > 50) captureLog.shift();
    mergeRecords(parsed);
    recompute();
    return hasClock;
  } catch (e) {
    console.error("[考勤] API 查询失败: " + (e as Error).message);
    captureLog.push({ url: `api:${yearMonth} 失败`, count: 0, time: new Date().toLocaleTimeString(), source: "api" });
    recompute();
    return false;
  } finally {
    apiFetching = false;
  }
}

function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function randDelay(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

async function backfillMonths(fromMonth: string): Promise<void> {
  let ym = fromMonth;
  for (;;) {
    if (!(await fetchMonth(ym))) break;
    ym = prevMonth(ym);
    if (ym < "2000-01") break;
    await new Promise((r) => setTimeout(r, randDelay(800, 2000)));
  }
}

recompute();
