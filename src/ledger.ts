import { timeToMinutes } from "./calc";

export interface LeaveEntry {
  id: string;
  /** 申请日期 YYYY-MM-DD：台账按它排序，并把抵扣池截断到这一天 */
  appliedDate: string;
  /** 请假日期 YYYY-MM-DD */
  date: string;
  start: string;
  end: string;
  reason: string;
}

export interface OvertimeDay {
  /** 加班日期 YYYY-MM-DD */
  date: string;
  minutes: number;
  /** false 表示该月还没上报给公司，不计入可抵扣时间 */
  reported?: boolean;
}

export interface LedgerDay {
  date: string;
  minutes: number;
  consumed: number;
  writtenOff: number;
  remaining: number;
}

export interface LeavePart {
  date: string;
  minutes: number;
  consumedBefore: number;
  remainingAfter: number;
}

export interface LeaveBreakdown {
  leave: LeaveEntry;
  minutes: number;
  parts: LeavePart[];
  uncovered: number;
  balanceBefore: number;
  balanceAfter: number;
}

export interface Ledger {
  startDate: string;
  days: LedgerDay[];
  breakdowns: LeaveBreakdown[];
  /** 可抵扣加班合计（已上报月份修正后的加班） */
  totalOvertime: number;
  /** 未上报月份的加班合计，不计入可抵扣时间 */
  unreportedMinutes: number;
  totalLeave: number;
  balance: number;
}

export function leaveMinutes(leave: LeaveEntry): number {
  return Math.max(timeToMinutes(leave.end) - timeToMinutes(leave.start), 0);
}

export function buildLedger(overtimeDays: OvertimeDay[], leaves: LeaveEntry[], startDate = ""): Ledger {
  const inRange = (d: OvertimeDay) => !startDate || d.date >= startDate;

  const items = overtimeDays
    .filter((d) => d.reported !== false && d.minutes !== 0 && inRange(d))
    .sort((a, b) => a.date.localeCompare(b.date));

  const days: LedgerDay[] = items
    .filter((d) => d.minutes > 0)
    .map((d) => ({ date: d.date, minutes: d.minutes, consumed: 0, writtenOff: 0, remaining: d.minutes }));

  // 某天加班被修正为负数时不做抵扣，而是「这些加班本来就不存在」：从该月起冲减最早的可抵扣加班
  const writeOffs = items.filter((d) => d.minutes < 0);
  let writeCursor = 0;
  for (const adj of writeOffs) {
    const month = adj.date.slice(0, 7);
    while (writeCursor < days.length && days[writeCursor].date.slice(0, 7) < month) writeCursor++;
    let write = -adj.minutes;
    while (write > 0 && writeCursor < days.length) {
      const day = days[writeCursor];
      const take = Math.min(day.remaining, write);
      day.writtenOff += take;
      day.remaining -= take;
      write -= take;
      if (day.remaining === 0) writeCursor++;
    }
  }

  // 每笔请假的抵扣池截断到它的申请月：上报是按月做的，申请当月肯定还没上报，
  // 所以只算申请月之前的已上报加班。这样之后新增或补报的加班不会回头改这笔请假的数（冻结），
  // 且完全由已存数据推导，可复现。
  const poolPrefix: number[] = [0];
  for (const d of days) poolPrefix.push(poolPrefix[poolPrefix.length - 1] + d.minutes - d.writtenOff);
  const poolAt = (capMonth: string): number => {
    if (!capMonth) return 0;
    let lo = 0;
    let hi = days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (days[mid].date.slice(0, 7) < capMonth) lo = mid + 1;
      else hi = mid;
    }
    return poolPrefix[lo];
  };

  // 按申请日期排；同一天保持录入先后
  const ordered = [...leaves].sort((a, b) => a.appliedDate.localeCompare(b.appliedDate));
  const totalOvertime = items.reduce((sum, d) => sum + d.minutes, 0);

  let cursor = 0;
  let takenByLeaves = 0;
  const breakdowns: LeaveBreakdown[] = [];

  for (const leave of ordered) {
    const minutes = leaveMinutes(leave);
    const capMonth = leave.appliedDate.slice(0, 7);
    const balanceBefore = poolAt(capMonth) - takenByLeaves;
    const parts: LeavePart[] = [];
    let need = minutes;

    while (need > 0 && cursor < days.length && days[cursor].date.slice(0, 7) < capMonth) {
      const day = days[cursor];
      const take = Math.min(day.remaining, need);
      if (take > 0) {
        parts.push({
          date: day.date,
          minutes: take,
          consumedBefore: day.consumed,
          remainingAfter: day.remaining - take,
        });
        day.consumed += take;
        day.remaining -= take;
        need -= take;
      }
      if (day.remaining === 0) cursor++;
    }

    takenByLeaves += minutes;
    breakdowns.push({ leave, minutes, parts, uncovered: need, balanceBefore, balanceAfter: balanceBefore - minutes });
  }

  return {
    startDate,
    days,
    breakdowns,
    totalOvertime,
    unreportedMinutes: overtimeDays
      .filter((d) => d.reported === false && inRange(d))
      .reduce((sum, d) => sum + d.minutes, 0),
    totalLeave: ordered.reduce((sum, l) => sum + leaveMinutes(l), 0),
    balance: totalOvertime - ordered.reduce((sum, l) => sum + leaveMinutes(l), 0),
  };
}

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

function weekdayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return WEEKDAY_LABELS[new Date(y, m - 1, d).getDay()];
}

function fmtDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

function fmtHM(minutes: number): string {
  const sign = minutes < 0 ? "-" : "";
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (m === 0) return `${sign}${h} 小时`;
  if (h === 0) return `${sign}${m} 分`;
  return `${sign}${h} 小时 ${m} 分`;
}

export function renderDeclaration(ledger: Ledger, leaveId: string): string {
  const bd = ledger.breakdowns.find((b) => b.leave.id === leaveId);
  if (!bd) return "";
  if (!bd.leave.appliedDate) return "这笔请假还没填申请日期，补填后再生成声明。";
  const { leave } = bd;

  const lines = [
    `本次请假 ${fmtHM(bd.minutes)}（${fmtDate(leave.date)} ${leave.start}–${leave.end}，事由：${leave.reason}），以加班时数抵扣。`,
    "",
    "抵扣加班：",
  ];

  if (bd.parts.length === 0) {
    lines.push("- （无可抵扣的加班时数）");
  } else {
    bd.parts.forEach((p, i) => {
      const day = ledger.days.find((d) => d.date === p.date);
      const overtime = day ? day.minutes : 0;
      const what = `${fmtDate(p.date)}（${weekdayLabel(p.date)}）加班 ${fmtHM(overtime)}`;
      const tail = i === bd.parts.length - 1 ? "。" : "；";
      lines.push(
        `- ${what}，此前已抵扣 ${fmtHM(p.consumedBefore)}，本次抵扣 ${fmtHM(p.minutes)}，` +
          `该笔剩余 ${fmtHM(p.remainingAfter)}${tail}`,
      );
    });
  }

  const uncoveredNote = bd.uncovered > 0 ? `，其中 ${fmtHM(bd.uncovered)}无加班可抵扣` : "";
  lines.push(
    "",
    `本次合计抵扣 ${fmtHM(bd.minutes)}${uncoveredNote}。` +
      `加班时数结余：抵扣前 ${fmtHM(bd.balanceBefore)}，抵扣后 ${fmtHM(bd.balanceAfter)}。`,
  );

  return lines.join("\n");
}
