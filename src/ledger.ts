import { timeToMinutes } from "./calc";

export interface LeaveEntry {
  id: string;
  date: string;
  start: string;
  end: string;
  reason: string;
}

export interface OvertimeDay {
  date: string;
  minutes: number;
}

export interface LedgerDay {
  date: string;
  minutes: number;
  consumed: number;
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
  totalOvertime: number;
  totalLeave: number;
  balance: number;
}

export function leaveMinutes(leave: LeaveEntry): number {
  return Math.max(timeToMinutes(leave.end) - timeToMinutes(leave.start), 0);
}

export function buildLedger(overtimeDays: OvertimeDay[], leaves: LeaveEntry[], startDate = ""): Ledger {
  const days: LedgerDay[] = overtimeDays
    .filter((d) => d.minutes > 0 && (!startDate || d.date >= startDate))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ date: d.date, minutes: d.minutes, consumed: 0, remaining: d.minutes }));

  const ordered = [...leaves].sort((a, b) => a.date.localeCompare(b.date));
  const totalOvertime = days.reduce((sum, d) => sum + d.minutes, 0);

  let cursor = 0;
  let balance = totalOvertime;
  const breakdowns: LeaveBreakdown[] = [];

  for (const leave of ordered) {
    const minutes = leaveMinutes(leave);
    const balanceBefore = balance;
    const parts: LeavePart[] = [];
    let need = minutes;

    while (need > 0 && cursor < days.length) {
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

    balance = balanceBefore - minutes;
    breakdowns.push({ leave, minutes, parts, uncovered: need, balanceBefore, balanceAfter: balance });
  }

  return {
    startDate,
    days,
    breakdowns,
    totalOvertime,
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
  const { leave } = bd;

  const lines = [
    "加班抵扣说明",
    "",
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
      const tail = i === bd.parts.length - 1 ? "。" : "；";
      lines.push(
        `- ${fmtDate(p.date)}（${weekdayLabel(p.date)}）加班 ${fmtHM(overtime)}，` +
          `此前已抵扣 ${fmtHM(p.consumedBefore)}，本次抵扣 ${fmtHM(p.minutes)}，` +
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
