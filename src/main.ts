import { fetchMonthAttendances, type AttendanceRecord } from "./api";
import { summarize, summarizeByMonth, withDayAdjustments, type WorkConfig } from "./calc";
import { autoFileName, buildFormXlsx, DEFAULT_FORM, renderOvertimeText, type FormConfig } from "./form";
import { buildLedger, type LeaveEntry, type OvertimeDay } from "./ledger";
import { createPanel } from "./panel";

const RECORDS_KEY = "zc-attendance-records";
const WORK_KEY = "zc-attendance-work";
const LEAVES_KEY = "zc-leave-records";
const LEAVE_START_KEY = "zc-leave-start";
const DAY_ADJUST_KEY = "zc-day-adjust";
const REPORTED_KEY = "zc-month-reported";
const FORM_KEY = "zc-form-config";
const DEFAULT_LEAVE_START = "2026-08-01";

const DEFAULT_WORK: WorkConfig = {
  lunchBreakMinutes: 60,
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

function loadLeaves(): LeaveEntry[] {
  const list: LeaveEntry[] = [];
  try {
    const stored = GM_getValue(LEAVES_KEY, "");
    if (!stored) return list;
    const arr = JSON.parse(stored);
    if (!Array.isArray(arr)) return list;
    for (const l of arr) {
      if (
        l &&
        typeof l.id === "string" &&
        typeof l.date === "string" &&
        typeof l.start === "string" &&
        typeof l.end === "string" &&
        typeof l.reason === "string"
      ) {
        list.push({ id: l.id, date: l.date, start: l.start, end: l.end, reason: l.reason });
      }
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return list;
}

function newLeaveId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function loadLeaveStart(): string {
  try {
    const stored = GM_getValue(LEAVE_START_KEY, DEFAULT_LEAVE_START);
    return typeof stored === "string" ? stored : DEFAULT_LEAVE_START;
  } catch {
    return DEFAULT_LEAVE_START;
  }
}

/** 每日加班的手工修正（分钟，可为负），key 为 YYYY-MM-DD */
function loadDayAdjust(): Record<string, number> {
  const out: Record<string, number> = {};
  try {
    const stored = GM_getValue(DAY_ADJUST_KEY, "");
    if (!stored) return out;
    const obj = JSON.parse(stored);
    if (!obj || typeof obj !== "object") return out;
    for (const [key, value] of Object.entries(obj)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(key) && typeof value === "number" && Number.isFinite(value) && value !== 0) {
        out[key] = value;
      }
    }
  } catch {
    /* 忽略损坏数据 */
  }
  return out;
}

/** 已上报给公司的月份，key 为 YYYY-MM；只有已上报月份的加班才能用来抵扣请假 */
function loadReportedMonths(): string[] {
  try {
    const stored = GM_getValue(REPORTED_KEY, "");
    if (!stored) return [];
    const arr = JSON.parse(stored);
    if (!Array.isArray(arr)) return [];
    return arr.filter((m): m is string => typeof m === "string" && /^\d{4}-\d{2}$/.test(m));
  } catch {
    return [];
  }
}

/** 加班申请单的填写内容（申请人/部门/项目/原因/文件名） */
function loadForm(): FormConfig {
  try {
    const stored = GM_getValue(FORM_KEY, "");
    if (!stored) return { ...DEFAULT_FORM };
    const obj = JSON.parse(stored);
    if (!obj || typeof obj !== "object") return { ...DEFAULT_FORM };
    const pick = (key: keyof FormConfig) => (typeof obj[key] === "string" ? obj[key] : "");
    return {
      fileName: pick("fileName"),
      applicant: pick("applicant"),
      dept: pick("dept"),
      project: pick("project"),
      reason: pick("reason"),
    };
  } catch {
    return { ...DEFAULT_FORM };
  }
}

let work: WorkConfig = loadWork();
const records = loadRecords();
let leaves: LeaveEntry[] = loadLeaves();
let leaveStart = loadLeaveStart();
let dayAdjust = loadDayAdjust();
let reportedMonths = loadReportedMonths();
let form: FormConfig = loadForm();
let apiFetching = false;
let backfilling = false;
let fetchingMonth = "";

const panel = createPanel(work, form, {
  onSaveWork(next: WorkConfig) {
    try {
      if (typeof next !== "object" || next === null || !Number.isFinite(next.lunchBreakMinutes)) {
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
    backfilling = true;
    fetchingMonth = fromMonth;
    recompute();
    backfillMonths(fromMonth).finally(() => {
      backfilling = false;
      recompute();
    });
  },
  onExport(all: AttendanceRecord[], monthKey?: string | null) {
    const recs = monthKey ? all.filter((r) => r.date.startsWith(monthKey)) : all;
    if (recs.length === 0) return;
    const { total, months } = summarizeByMonth(recs, work);
    const lines = ["日期,上班,下班,工时(小时),加班(小时)"];
    for (const m of [...months].reverse()) {
      for (const d of m.summary.days) {
        lines.push(
          d.incomplete
            ? `${d.date},${d.clockIn ?? ""},${d.clockOut ?? ""},,`
            : `${d.date},${d.clockIn},${d.clockOut},${(d.workedMinutes / 60).toFixed(2)},${(d.overtimeMinutes / 60).toFixed(2)}`,
        );
      }
      lines.push(
        `${m.label}小计,,,${(m.summary.totalWorkedMinutes / 60).toFixed(2)},${(m.summary.totalOvertimeMinutes / 60).toFixed(2)}`,
      );
    }
    lines.push(`总计,,,${(total.totalWorkedMinutes / 60).toFixed(2)},${(total.totalOvertimeMinutes / 60).toFixed(2)}`);
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = monthKey
      ? `attendance-${monthKey}.csv`
      : `attendance-all-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  onSaveForm(next: FormConfig) {
    form = next;
    GM_setValue(FORM_KEY, JSON.stringify(form));
    return { ok: true };
  },
  onExportForm(monthKey: string | null, next: FormConfig) {
    if (!monthKey) return;
    form = next;
    GM_setValue(FORM_KEY, JSON.stringify(form));
    const days = withDayAdjustments(
      summarize(
        [...records.values()].filter((r) => r.date.startsWith(monthKey)),
        work,
      ),
      dayAdjust,
    ).days;
    const bytes = buildFormXlsx(form, renderOvertimeText(days));
    const blob = new Blob([new Uint8Array(bytes)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    const name = form.fileName || autoFileName(monthKey, form.applicant);
    a.download = /\.xlsx$/i.test(name) ? name : `${name}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  },
  onAddLeave(input) {
    const { date, start, end } = input;
    const reason = input.reason.trim();
    if (!date || !start || !end || !reason) {
      return { ok: false, error: "日期、开始/结束时间、事由都要填" };
    }
    if (end <= start) {
      return { ok: false, error: "结束时间要晚于开始时间" };
    }
    leaves.push({ id: newLeaveId(), date, start, end, reason });
    persistLeaves();
    recompute();
    return { ok: true };
  },
  onDeleteLeave(id: string) {
    leaves = leaves.filter((l) => l.id !== id);
    persistLeaves();
    recompute();
  },
  onSaveLeaveStart(date: string) {
    leaveStart = date;
    GM_setValue(LEAVE_START_KEY, date);
    recompute();
  },
  onSaveDayAdjust(date: string, minutes: number) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return { ok: false, error: "日期格式不合法" };
    }
    if (!Number.isInteger(minutes)) {
      return { ok: false, error: "修正值要填整数分钟" };
    }
    if (minutes === 0) delete dayAdjust[date];
    else dayAdjust[date] = minutes;
    persistDayAdjust();
    recompute();
    return { ok: true };
  },
  onToggleReported(month: string, reported: boolean) {
    if (!/^\d{4}-\d{2}$/.test(month)) return;
    reportedMonths = reported
      ? [...new Set([...reportedMonths, month])]
      : reportedMonths.filter((m) => m !== month);
    persistReportedMonths();
    recompute();
  },
  onClear() {
    records.clear();
    persist();
    recompute();
  },
});

function persistLeaves(): void {
  GM_setValue(LEAVES_KEY, JSON.stringify(leaves));
}

function persistDayAdjust(): void {
  GM_setValue(DAY_ADJUST_KEY, JSON.stringify(dayAdjust));
}

function persistReportedMonths(): void {
  GM_setValue(REPORTED_KEY, JSON.stringify(reportedMonths));
}

function persist(): void {
  GM_setValue(
    RECORDS_KEY,
    JSON.stringify(
      [...records.values()].map(({ date, clockIn, clockOut }) => ({ date, clockIn, clockOut })),
    ),
  );
}

function recompute(): void {
  const all = [...records.values()];
  const { total, months } = summarizeByMonth(all, work);
  const adjustedTotal = withDayAdjustments(total, dayAdjust);
  const adjustedMonths = months.map((m) => ({ ...m, summary: withDayAdjustments(m.summary, dayAdjust) }));

  // 台账直接用修正后的每日加班，保证「加班统计」的合计数与抵扣池一致
  const reported = new Set(reportedMonths);
  const overtimeDays: OvertimeDay[] = adjustedTotal.days.map((d) => ({
    date: d.date,
    minutes: d.overtimeMinutes,
    reported: reported.has(d.date.slice(0, 7)),
  }));

  const ledger = buildLedger(overtimeDays, leaves, leaveStart);
  const busy = apiFetching || backfilling
    ? ({ mode: apiFetching ? "fetch" : "backfill", month: fetchingMonth } as const)
    : null;
  panel.update(adjustedTotal, adjustedMonths, all, ledger, dayAdjust, reportedMonths, busy);
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
  fetchingMonth = yearMonth;
  try {
    const parsed = await fetchMonthAttendances(yearMonth);
    const hasClock = parsed.some((r) => r.clockIn || r.clockOut);
    mergeRecords(parsed);
    return hasClock;
  } catch (e) {
    console.error("[考勤] API 查询失败: " + (e as Error).message);
    return false;
  } finally {
    apiFetching = false;
    recompute();
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

async function backfillMonths(fromMonth: string): Promise<string> {
  let ym = fromMonth;
  let lastOk = "";
  for (;;) {
    if (!(await fetchMonth(ym))) break;
    lastOk = ym;
    ym = prevMonth(ym);
    if (ym < "2000-01") break;
    await new Promise((r) => setTimeout(r, randDelay(800, 2000)));
  }
  return lastOk || "";
}

recompute();
