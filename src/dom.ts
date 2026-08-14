export interface AttendanceRecord {
  date: string;
  clockIn: string | null;
  clockOut: string | null;
}

const CELL_SEL = ".ant-fullcalendar-cell";
const DATE_SEL = ".ant-fullcalendar-date";
const DAY_SEL = ".ant-fullcalendar-value";
const SIGN_SEL = ".calendar-sign-info";
export const MONTH_INPUT_SEL = 'input[placeholder="请选择年月"]';

export function extractFromCalendar(): AttendanceRecord[] {
  const month = resolveMonth();
  if (!month) return [];
  const records: AttendanceRecord[] = [];
  const cells = document.querySelectorAll(CELL_SEL);
  for (const cell of Array.from(cells)) {
    const cls = cell.className || "";
    if (cls.includes("last-month-cell") || cls.includes("next-month-btn-day")) continue;
    const row = cell.querySelector(DATE_SEL);
    if (!row) continue;
    const dayEl = row.querySelector(DAY_SEL);
    const day = Number((dayEl?.textContent ?? "").trim());
    if (!Number.isInteger(day) || day < 1 || day > 31) continue;
    const signs = row.querySelectorAll(SIGN_SEL);
    const inText = matchSign(signs, "上班");
    const outText = matchSign(signs, "下班");
    records.push({
      date: `${month}-${String(day).padStart(2, "0")}`,
      clockIn: extractHhmm(inText),
      clockOut: extractHhmm(outText),
    });
  }
  return records;
}

export function resolveMonth(): string | null {
  const input = document.querySelector<HTMLInputElement>(MONTH_INPUT_SEL);
  const raw = input?.value?.trim();
  if (raw) {
    const m = raw.match(/^(\d{4})-(\d{1,2})$/);
    if (m) {
      const mo = Number(m[2]);
      if (mo >= 1 && mo <= 12) return `${m[1]}-${String(mo).padStart(2, "0")}`;
    }
  }
  return null;
}

function matchSign(signs: NodeListOf<Element>, label: string): string {
  for (const s of Array.from(signs)) {
    const t = (s.textContent ?? "").trim();
    if (t.startsWith(`${label}打卡`)) return t;
  }
  return "";
}

function extractHhmm(text: string): string | null {
  const m = text.match(/\d{1,2}:\d{2}/);
  return m ? m[0] : null;
}
