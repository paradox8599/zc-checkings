import type { AttendanceRecord } from "./dom";

interface SignInfo {
  signTime: string;
  title: string;
}

interface MonthResponse {
  result?: Record<string, { date: string; signInfo?: SignInfo[] }>;
  status?: string;
  message?: string;
}

export async function fetchMonthAttendances(yearMonth: string): Promise<AttendanceRecord[]> {
  const body = `typevalue=${yearMonth}&loaddata=1&type=2&`;
  const resp = await fetch("/api/kq/myattendance/getHrmKQMonthReportInfo", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!resp.ok) throw new Error(`请求失败: HTTP ${resp.status}`);
  const json = (await resp.json()) as MonthResponse;
  if (!json.result) throw new Error(json.message || "接口未返回数据");
  const records: AttendanceRecord[] = [];
  for (const day of Object.values(json.result)) {
    if (!day || typeof day.date !== "string") continue;
    let clockIn: string | null = null;
    let clockOut: string | null = null;
    for (const s of day.signInfo ?? []) {
      const hm = /(\d{1,2}:\d{2})/.exec(s.signTime ?? "");
      if (!hm) continue;
      if (s.title?.includes("上班")) clockIn = hm[1];
      else if (s.title?.includes("下班")) clockOut = hm[1];
    }
    records.push({ date: day.date, clockIn, clockOut });
  }
  return records.sort((a, b) => a.date.localeCompare(b.date));
}
