import type { WorkConfig, Summary, MonthGroup } from "./calc";
import type { AttendanceRecord } from "./dom";
import { fmtDuration, minutesToHhmm } from "./calc";

export interface PanelActions {
  onSaveWork(work: WorkConfig): { ok: boolean; error?: string };
  onApiFetchMonth(month: string): void;
  onApiBackfill(fromMonth: string): void;
  onExport(records: AttendanceRecord[]): void;
  onClear(): void;
}

export interface Panel {
  update(
    summary: Summary,
    months: MonthGroup[],
    records: AttendanceRecord[],
    captureLog: Array<{ url: string; count: number; time: string; source: string }>,
  ): void;
}

export function createPanel(work: WorkConfig, actions: PanelActions): Panel {
  const root = document.createElement("div");
  root.id = "zc-attendance-panel";
  root.style.cssText = [
    "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
    "width:560px", "max-height:90vh", "overflow:auto",
    "background:#fff", "color:#222", "border:1px solid #ccc", "border-radius:8px",
    "box-shadow:0 4px 16px rgba(0,0,0,.25)", "font:12px/1.5 -apple-system,sans-serif",
    "padding:0", "box-sizing:border-box", "display:none",
  ].join(";");

  const style = document.createElement("style");
  style.textContent = [
    `#zc-attendance-panel{border-color:#d5d9e0;box-shadow:0 6px 24px rgba(30,50,90,.18);padding:0}`,
    `#zc-attendance-panel .zc-header{background:linear-gradient(135deg,#3a5a9c,#5b7fd4);color:#fff;padding:8px 12px;border-radius:8px 8px 0 0;margin:0}`,
    `#zc-attendance-panel .zc-header h3{margin:0;font-size:13px;color:#fff}`,
    `#zc-attendance-panel .zc-header button{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.35);border-radius:4px;font-size:11px;padding:1px 8px;cursor:pointer}`,
    `#zc-attendance-panel .zc-header button:hover{background:rgba(255,255,255,.28)}`,
    `#zc-attendance-panel .zc-content{padding:10px}`,
    `#zc-attendance-panel table{border-collapse:collapse;width:100%;font-size:11px}`,
    `#zc-attendance-panel th{background:#eef1f7;color:#3a5a9c;font-weight:600;border:1px solid #dfe3ec;padding:3px 4px;text-align:right;position:sticky;top:0}`,
    `#zc-attendance-panel td{border:1px solid #e8ebf1;padding:2px 4px;text-align:right}`,
    `#zc-attendance-panel th:first-child,#zc-attendance-panel td:first-child{text-align:left}`,
    `#zc-attendance-panel tbody tr:nth-child(even){background:#f8f9fc}`,
    `#zc-attendance-panel .ov td{background:#fff8e6}`,
    `#zc-attendance-panel .incomplete td{color:#a5adb8}`,
    `#zc-attendance-panel tr.weekend td{background:#f2eafa;color:#6d4fc1}`,
    `#zc-attendance-panel tr.weekend td:first-child{font-weight:600}`,
    `#zc-attendance-panel tr.today td{border-top:2px solid #4a90d9;border-bottom:2px solid #4a90d9;padding-top:3px;padding-bottom:3px}`,
    `#zc-attendance-panel tr.today td:first-child{border-left:2px solid #4a90d9}`,
    `#zc-attendance-panel tr.today td:last-child{border-right:2px solid #4a90d9}`,
    `#zc-attendance-panel tr.today td:first-child{font-weight:600}`,
    `#zc-attendance-panel .btn{margin:4px 4px 0 0;font-size:11px;padding:3px 10px;cursor:pointer;border:1px solid #c3cbdc;border-radius:4px;background:#fff;color:#3a5a9c}`,
    `#zc-attendance-panel .btn:hover{background:#eef1f7}`,
    `#zc-attendance-panel .stat{display:flex;flex-direction:column;gap:6px;margin-bottom:8px}`,
    `#zc-attendance-panel .stat-line{display:flex;flex-wrap:wrap;gap:6px}`,
    `#zc-attendance-panel .stat-line .chip{background:#f2f5fb;border:1px solid #e2e7f1;border-radius:6px;padding:2px 8px;font-size:11px;color:#5a6478}`,
    `#zc-attendance-panel .stat-line .chip b{color:#3a5a9c}`,
    `#zc-attendance-panel .stat-label{font-size:11px;color:#7a8499;margin-bottom:2px}`,
    `#zc-attendance-panel .month-side{flex:0 0 96px;display:flex;flex-direction:column;gap:2px;border-right:1px solid #e8ebf1;padding-right:6px}`,
    `#zc-attendance-panel .month-btn{display:block;width:100%;text-align:left;padding:3px 6px;font-size:11px;cursor:pointer;border:none;background:none;border-radius:4px;color:#4a5468}`,
    `#zc-attendance-panel .month-btn:hover{background:#eef1f7}`,
    `#zc-attendance-panel .month-btn.active{background:#3a5a9c;color:#fff;font-weight:600}`,
  ].join("\n");
  root.appendChild(style);

  const header = document.createElement("div");
  header.className = "zc-header";
  header.style.cssText = "display:flex;justify-content:space-between;align-items:center";
  const title = document.createElement("h3");
  title.textContent = "考勤加班统计";
  header.appendChild(title);
  const collapseBtn = document.createElement("button");
  collapseBtn.textContent = "收起";
  header.appendChild(collapseBtn);
  root.appendChild(header);
  const contentWrap = document.createElement("div");
  contentWrap.className = "zc-content";
  root.appendChild(contentWrap);

  const now = new Date();
  const curYear = now.getFullYear();
  let apiYear = curYear;
  let apiMonthNum = now.getMonth() + 1;
  const apiMonthStr = () => `${apiYear}-${String(apiMonthNum).padStart(2, "0")}`;
  const monthRow = document.createElement("div");
  monthRow.style.cssText = "display:flex;align-items:center;gap:4px;justify-content:space-between;margin:0 0 8px";
  const monthNav = document.createElement("div");
  monthNav.style.cssText = "display:flex;align-items:center;gap:8px";

  const yearSel = document.createElement("select");
  yearSel.style.cssText = "font-size:12px;padding:1px 2px";
  for (let y = curYear; y >= 2015; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = `${y} 年`;
    yearSel.appendChild(opt);
  }
  yearSel.value = String(apiYear);

  const monthSel = document.createElement("select");
  monthSel.style.cssText = "font-size:12px;padding:1px 2px";
  for (let m = 1; m <= 12; m++) {
    const opt = document.createElement("option");
    opt.value = String(m);
    opt.textContent = `${m} 月`;
    monthSel.appendChild(opt);
  }
  monthSel.value = String(apiMonthNum);

  yearSel.onchange = () => {
    apiYear = Number(yearSel.value);
  };
  monthSel.onchange = () => {
    apiMonthNum = Number(monthSel.value);
  };

  monthNav.append(yearSel, monthSel);
  const fetchBtn = document.createElement("button");
  fetchBtn.type = "button";
  fetchBtn.textContent = "获取";
  fetchBtn.className = "btn";
  fetchBtn.onclick = () => actions.onApiFetchMonth(apiMonthStr());
  const backfillBtn = document.createElement("button");
  backfillBtn.type = "button";
  backfillBtn.textContent = "回溯";
  backfillBtn.className = "btn";
  backfillBtn.onclick = () => actions.onApiBackfill(apiMonthStr());
  monthRow.append(monthNav, fetchBtn, backfillBtn);
  contentWrap.appendChild(monthRow);

  const miniBtn = document.createElement("button");
  miniBtn.textContent = "加班统计";
  miniBtn.style.cssText = [
    "position:fixed", "top:16px", "right:16px", "z-index:2147483647",
    "font-size:11px", "padding:3px 10px", "cursor:pointer",
    "border:none", "border-radius:6px", "background:linear-gradient(135deg,#3a5a9c,#5b7fd4)",
    "color:#fff", "box-shadow:0 2px 8px rgba(58,90,156,.35)", "display:none",
  ].join(";");

  const setCollapsed = (collapsed: boolean) => {
    if (collapsed) {
      root.style.display = "none";
      miniBtn.style.display = "";
    } else {
      root.style.display = "";
      miniBtn.style.display = "none";
    }
  };
  const collapseBody = () => {
    setCollapsed(root.style.display !== "none");
  };
  collapseBtn.onclick = collapseBody;
  miniBtn.onclick = collapseBody;

  const summaryEl = document.createElement("div");
  summaryEl.className = "stat";
  contentWrap.appendChild(summaryEl);

  const body = document.createElement("div");
  contentWrap.appendChild(body);

  const configBox = document.createElement("div");

  const form = document.createElement("div");
  form.style.cssText = "display:flex;flex-direction:column;gap:4px;margin:6px 0";

  const mkRow = (label: string, ctrl: HTMLInputElement | HTMLSelectElement) => {
    const row = document.createElement("label");
    row.style.cssText = "display:flex;justify-content:space-between;align-items:center;gap:8px";
    const span = document.createElement("span");
    span.textContent = label;
    row.append(span, ctrl);
    return row;
  };

  const startIn = document.createElement("input");
  startIn.type = "time";
  startIn.value = work.standardStart;

  const endIn = document.createElement("input");
  endIn.type = "time";
  endIn.value = work.standardEnd;
  const lunchIn = document.createElement("input");
  lunchIn.type = "number";
  lunchIn.min = "0";
  lunchIn.step = "5";
  lunchIn.value = String(work.lunchBreakMinutes);
  lunchIn.style.width = "70px";
  const bufferIn = document.createElement("input");
  bufferIn.type = "number";
  bufferIn.min = "0";
  bufferIn.step = "5";
  bufferIn.value = String(work.overtimeBufferMinutes);
  bufferIn.style.width = "70px";
  const fromSel = document.createElement("select");
  const optThreshold = document.createElement("option");
  optThreshold.value = "threshold";
  optThreshold.textContent = "下班超过标准+宽限才计加班";
  const optStandard = document.createElement("option");
  optStandard.value = "standard";
  optStandard.textContent = "下班超过标准时间就计加班";
  const opt8Hours = document.createElement("option");
  opt8Hours.value = "8hours";
  opt8Hours.textContent = "工作日超8小时就计加班";
  fromSel.append(optThreshold, optStandard, opt8Hours);
  fromSel.value = work.overtimeFrom;

  form.append(
    mkRow("上班时间", startIn),
    mkRow("下班时间", endIn),
    mkRow("午休(分钟)", lunchIn),
    mkRow("宽限(分钟)", bufferIn),
    mkRow("加班计算", fromSel),
  );
  configBox.appendChild(form);

  const btnRow = document.createElement("div");
  const saveBtn = document.createElement("button");
  saveBtn.textContent = "保存";
  saveBtn.className = "btn";
  saveBtn.onclick = () => {
    const next: WorkConfig = {
      standardStart: startIn.value,
      standardEnd: endIn.value,
      lunchBreakMinutes: Number(lunchIn.value),
      overtimeBufferMinutes: Number(bufferIn.value),
      overtimeFrom: fromSel.value as WorkConfig["overtimeFrom"],
    };
    const res = actions.onSaveWork(next);
    if (!res.ok) alert("保存失败: " + res.error);
  };
  const exportBtn = document.createElement("button");
  exportBtn.textContent = "导出 CSV";
  exportBtn.className = "btn";
  exportBtn.onclick = () => actions.onExport(currentRecords);
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "清空数据";
  clearBtn.className = "btn";
  clearBtn.onclick = () => actions.onClear();
  btnRow.append(saveBtn, exportBtn, clearBtn);
  configBox.appendChild(btnRow);

  const toggleBtn = document.createElement("button");
  toggleBtn.textContent = "工作时段配置";
  toggleBtn.className = "btn";
  toggleBtn.onclick = () => {
    configBox.style.display = configBox.style.display === "none" ? "" : "none";
  };
  contentWrap.appendChild(toggleBtn);
  configBox.style.display = "none";
  contentWrap.appendChild(configBox);

  let currentRecords: AttendanceRecord[] = [];
  let selectedKey: string | null = null;
  let attached = false;
  const logEl = document.createElement("div");
  logEl.style.cssText = "font:10px/1.4 monospace;color:#666;margin-top:6px;max-height:120px;overflow:auto;display:none";
  contentWrap.appendChild(logEl);
  const logToggle = document.createElement("button");
  logToggle.textContent = "捕获日志";
  logToggle.className = "btn";
  logToggle.onclick = () => {
    logEl.style.display = logEl.style.display === "none" ? "" : "none";
  };
  contentWrap.appendChild(logToggle);

  function ensureAttached() {
    if (attached) return;
    const attach = () => {
      if (attached) return;
      document.body.appendChild(root);
      document.body.appendChild(miniBtn);
      attached = true;
      setCollapsed(true);
    };
    if (!document.body) {
      window.addEventListener("DOMContentLoaded", attach);
      return;
    }
    attach();
  }

  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  function renderMonthTable(days: Summary["days"]): HTMLTableElement {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const table = document.createElement("table");
    table.innerHTML =
      "<tr><th>日期</th><th>星期</th><th>上班</th><th>下班</th><th>工时</th><th>加班</th></tr>";
    for (const d of days) {
      const tr = document.createElement("tr");
      const wd = new Date(d.date + "T00:00:00").getDay();
      const isWeekend = wd === 0 || wd === 6;
      if (isWeekend) tr.className = "weekend";
      else if (d.incomplete) tr.className = "incomplete";
      else if (d.overtimeMinutes > 0) tr.className = "ov";
      if (d.date === todayStr) tr.classList.add("today");
      const td = (txt: string) => {
        const c = document.createElement("td");
        c.textContent = txt;
        return c;
      };
      tr.appendChild(td(d.date));
      tr.appendChild(td(isWeekend ? `周${WEEKDAYS[wd]}` : `周${WEEKDAYS[wd]}`));
      tr.appendChild(td(d.clockIn ?? "--"));
      tr.appendChild(td(d.clockOut ?? "--"));
      tr.appendChild(td(d.incomplete ? "--" : minutesToHhmm(d.workedMinutes)));
      tr.appendChild(td(d.overtimeMinutes > 0 ? minutesToHhmm(d.overtimeMinutes) : "--"));
      table.appendChild(tr);
    }
    return table;
  }

  function renderStats(s: Summary): HTMLElement {
    const items: Array<[string, string]> = [
      ["出勤天数", String(s.workedDays)],
      ["平均工时", fmtDuration(s.avgWorkedMinutes)],
      ["加班天数", String(s.overtimeDays)],
      ["总加班", fmtDuration(s.totalOvertimeMinutes)],
      ["总工时", fmtDuration(s.totalWorkedMinutes)],
    ];
    const line = document.createElement("div");
    line.className = "stat-line";
    for (const [k, v] of items) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.innerHTML = `${k} <b>${v}</b>`;
      line.appendChild(chip);
    }
    return line;
  }

  function update(
    summary: Summary,
    months: MonthGroup[],
    records: AttendanceRecord[],
    captureLog: Array<{ url: string; count: number; time: string; source: string }>,
  ): void {
    currentRecords = records;
    ensureAttached();
    if (!attached) return;

    logEl.innerHTML = "";
    if (captureLog.length === 0) {
      logEl.textContent = "尚未捕获任何数据。请切换到考勤日历页面。";
    } else {
      for (const c of [...captureLog].reverse()) {
        const line = document.createElement("div");
        line.textContent = `[${c.time}] [${c.source}] ${c.url} → ${c.count}条`;
        logEl.appendChild(line);
      }
    }

    summaryEl.innerHTML = "";
    const summaryBox = document.createElement("div");
    summaryBox.className = "stat";
    const totalLabel = document.createElement("div");
    const totalTag = document.createElement("div");
    totalTag.className = "stat-label";
    totalTag.textContent = "全部";
    totalLabel.appendChild(totalTag);
    totalLabel.appendChild(renderStats(summary));
    summaryBox.appendChild(totalLabel);
    summaryEl.appendChild(summaryBox);

    body.innerHTML = "";
    if (months.length === 0) {
      body.textContent = "暂无打卡数据。请切换到考勤日历页面。";
      return;
    }
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:8px;align-items:flex-start";
    const side = document.createElement("div");
    side.className = "month-side";
    const content = document.createElement("div");
    content.style.cssText = "flex:1;min-width:0";

    let selected = selectedKey ?? null;
    const monthStatEl = document.createElement("div");
    summaryEl.appendChild(monthStatEl);
    const renderContent = () => {
      const g = months.find((m) => m.key === selected);
      content.innerHTML = "";
      monthStatEl.innerHTML = "";
      if (!g) return;
      const label = document.createElement("div");
      label.className = "stat-label";
      label.textContent = g.label;
      monthStatEl.appendChild(label);
      monthStatEl.appendChild(renderStats(g.summary));
      const head = document.createElement("div");
      head.style.cssText = "font-weight:600;margin-bottom:4px;color:#3a5a9c";
      head.textContent =
        `${g.label}  出勤${g.summary.workedDays}天  加班${fmtDuration(g.summary.totalOvertimeMinutes)}`;
      content.appendChild(head);
      content.appendChild(renderMonthTable(g.summary.days));
      for (const btn of Array.from(side.querySelectorAll<HTMLButtonElement>(".month-btn"))) {
        btn.classList.toggle("active", btn.dataset.key === selected);
      }
    };

    for (const group of months) {
      const btn = document.createElement("button");
      btn.className = "month-btn";
      btn.dataset.key = group.key;
      btn.textContent = group.label;
      btn.onclick = () => {
        selected = group.key;
        selectedKey = group.key;
        renderContent();
      };
      side.appendChild(btn);
      if (selected === null) selected = group.key;
    }
    if (!months.some((m) => m.key === selected)) selected = months[0].key;
    selectedKey = selected;
    renderContent();
    wrap.append(side, content);
    body.appendChild(wrap);
  }

  return { update };
}
