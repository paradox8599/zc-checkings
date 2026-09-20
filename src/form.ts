import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import template from "./assets/overtime-form.xlsx";
import type { DayStat } from "./calc";

/** 加班申请单的填写内容，全部由用户在面板「设置」里维护并持久化 */
export interface FormConfig {
  /** 导出文件名（不含扩展名）；为空时按月份自动生成 */
  fileName: string;
  applicant: string;
  dept: string;
  project: string;
  reason: string;
}

export const DEFAULT_FORM: FormConfig = {
  fileName: "",
  applicant: "",
  dept: "",
  project: "",
  reason: "",
};

/** 默认文件名：`yyyy年m月加班申请单`，填了申请人则追加 `-申请人` */
export function autoFileName(monthKey: string, applicant: string): string {
  const [y, m] = monthKey.split("-");
  const base = `${y}年${Number(m)}月加班申请单`;
  return applicant ? `${base}-${applicant}` : base;
}

function fmtHM(minutes: number): string {
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} m`;
}

/** 按模板格式生成「加班时间」多行文本：逐日 `自 … 时至 … 时，共计 X h YY m`，末尾 `总计 …` */
export function renderOvertimeText(days: DayStat[]): string {
  const lines: string[] = [];
  let total = 0;
  for (const d of days) {
    if (d.overtimeMinutes <= 0 || !d.clockIn || !d.clockOut) continue;
    total += d.overtimeMinutes;
    const [y, m, day] = d.date.split("-");
    const ymd = `${Number(y)} 年 ${m} 月 ${day} 日`;
    lines.push(`自 ${ymd} ${d.clockIn} 时至 ${ymd} ${d.clockOut} 时，共计 ${fmtHM(d.overtimeMinutes)}`);
  }
  lines.push(`总计 ${fmtHM(total)}`);
  return lines.join("\n");
}

function escXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "&#10;");
}

/** 以模板生成填好内容的申请表 xlsx */
export function buildFormXlsx(form: FormConfig, overtimeText: string): Uint8Array {
  const files = unzipSync(template);
  files["xl/sharedStrings.xml"] = strToU8(
    strFromU8(files["xl/sharedStrings.xml"])
      .replace("@@ZC_APPLICANT@@", escXml(form.applicant))
      .replace("@@ZC_DEPT@@", escXml(form.dept))
      .replace("@@ZC_PROJECT@@", escXml(form.project))
      .replace("@@ZC_REASON@@", escXml(form.reason))
      .replace("@@ZC_OVERTIME@@", escXml(overtimeText)),
  );
  return zipSync(files, { level: 6 });
}
