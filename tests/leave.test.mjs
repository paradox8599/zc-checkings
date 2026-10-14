import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const result = await build({
  stdin: {
    contents: 'export * from "./src/calc"; export * from "./src/ledger";',
    resolveDir: fileURLToPath(new URL("../", import.meta.url)),
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
});
const { buildLedger, computeDay, isValidWorkConfig, leaveMinutes, renderDeclaration } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
);

const work = { lunchStart: "12:00", lunchEnd: "13:00" };
const overtime = [{ date: "2026-09-01", minutes: 1200, reported: true }];
const leave = (id, start, end, date = "2026-10-12", appliedDate = "2026-10-01") => ({
  id, start, end, date, appliedDate, reason: "测试",
});

const cases = [
  ["无请假", [], []],
  ["全天请假扣午休后为8小时", [leave("1", "09:00", "18:00")], [480]],
  ["跨午休11–14为2小时", [leave("1", "11:00", "14:00")], [120]],
  ["午休内请假不抵扣", [leave("1", "12:00", "13:00")], [0]],
  ["部分重叠只扣重叠的30分钟", [leave("1", "11:30", "12:30")], [30]],
  ["午休前请假不扣午休", [leave("1", "09:00", "12:00")], [180]],
  ["午休后请假不扣午休", [leave("1", "13:00", "18:00")], [300]],
  ["同日多条合计最多8小时", [leave("1", "08:00", "12:00"), leave("2", "13:00", "19:00")], [240, 240]],
  ["当日额度用完后后续条目为0", [leave("1", "09:00", "18:00"), leave("2", "18:00", "19:00")], [480, 0]],
  ["不同请假日期分别计算上限", [leave("1", "09:00", "18:00"), leave("2", "09:00", "18:00", "2026-10-13")], [480, 480]],
];

for (const [name, leaves, expected] of cases) {
  test(name, () => {
    const ledger = buildLedger(overtime, leaves, work);
    const total = expected.reduce((sum, minutes) => sum + minutes, 0);
    assert.deepEqual(ledger.breakdowns.map((bd) => bd.minutes), expected);
    assert.equal(ledger.totalLeave, total);
    assert.equal(ledger.balance, 1200 - total);
    assert.equal(ledger.days.reduce((sum, day) => sum + day.consumed, 0), total);
    assert.equal(ledger.days.reduce((sum, day) => sum + day.remaining, 0), ledger.balance);
    assert.equal(ledger.breakdowns.at(-1)?.balanceAfter ?? 1200, ledger.balance);
  });
}

test("自定义午休只扣配置窗口的重叠", () => {
  const custom = { ...work, lunchStart: "12:30", lunchEnd: "13:30" };
  const ledger = buildLedger(overtime, [leave("1", "12:00", "14:00")], custom);
  assert.equal(leaveMinutes(leave("1", "12:00", "14:00"), custom), 60);
  assert.equal(ledger.totalLeave, 60);
  assert.equal(ledger.balance, 1140);
});

test("每日额度按申请日期分配且不修改原始记录", () => {
  const leaves = [
    leave("later", "13:00", "19:00", "2026-10-12", "2026-10-02"),
    leave("first", "08:00", "12:00"),
  ];
  const ledger = buildLedger(overtime, leaves, work);
  assert.deepEqual(ledger.breakdowns.map((bd) => [bd.leave.id, bd.minutes]), [["first", 240], ["later", 240]]);
  assert.equal(ledger.totalLeave, 480);
  assert.equal(ledger.balance, 720);
  assert.deepEqual(leaves.map((entry) => entry.id), ["later", "first"]);
  assert.deepEqual(buildLedger(overtime, leaves, work), ledger);
});

test("加班不足时合计、负余额和声明一致", () => {
  const ledger = buildLedger([{ date: "2026-09-01", minutes: 60 }], [leave("1", "09:00", "18:00")], work);
  const bd = ledger.breakdowns[0];
  assert.equal(bd.minutes, 480);
  assert.equal(bd.uncovered, 420);
  assert.equal(bd.balanceAfter, -420);
  assert.equal(ledger.totalLeave, 480);
  assert.equal(ledger.balance, -420);
  assert.match(renderDeclaration(ledger, "1"), /本次请假 8 小时/);
  assert.match(renderDeclaration(ledger, "1"), /其中 7 小时无加班可抵扣/);
  assert.match(renderDeclaration(ledger, "1"), /抵扣前 1 小时，抵扣后 -7 小时/);
});

test("未上报月份和申请当月仍不参与抵扣", () => {
  const ledger = buildLedger([
    { date: "2026-08-01", minutes: 120, reported: false },
    { date: "2026-09-01", minutes: 60, reported: true },
    { date: "2026-10-01", minutes: 120, reported: true },
  ], [leave("1", "09:00", "12:00")], work);
  assert.equal(ledger.totalLeave, 180);
  assert.equal(ledger.balance, 0);
  assert.equal(ledger.unreportedMinutes, 120);
  assert.deepEqual(ledger.breakdowns[0].parts.map((part) => [part.date, part.minutes]), [["2026-09-01", 60]]);
  assert.equal(ledger.breakdowns[0].uncovered, 120);
  assert.equal(ledger.breakdowns[0].balanceAfter, -120);
});

test("考勤未跨午休不扣减，08:44–11:46 为3小时2分", () => {
  for (const [date, overtimeMinutes] of [["2026-10-11", 182], ["2026-10-12", 0]]) {
    const stat = computeDay({ date, clockIn: "08:44", clockOut: "11:46" }, work);
    assert.equal(stat.workedMinutes, 182);
    assert.equal(stat.overtimeMinutes, overtimeMinutes);
  }
});

test("考勤部分跨午休只扣重叠的30分钟", () => {
  const stat = computeDay({ date: "2026-10-11", clockIn: "11:30", clockOut: "12:30" }, work);
  assert.equal(stat.workedMinutes, 30);
  assert.equal(stat.overtimeMinutes, 0);
});

test("考勤完整跨默认午休仍扣1小时", () => {
  const stat = computeDay({ date: "2026-10-12", clockIn: "09:00", clockOut: "18:00" }, work);
  assert.equal(stat.workedMinutes, 480);
  assert.equal(stat.overtimeMinutes, 0);
});

test("考勤按自定义午休窗口扣除", () => {
  const stat = computeDay({ date: "2026-10-12", clockIn: "09:00", clockOut: "19:00" }, {
    ...work, lunchStart: "12:00", lunchEnd: "14:00",
  });
  assert.equal(stat.workedMinutes, 480);
  assert.equal(stat.overtimeMinutes, 0);
});

test("正常及跨小时边界的午休配置可保存", () => {
  assert.equal(isValidWorkConfig(work), true);
  assert.equal(isValidWorkConfig({ ...work, lunchStart: "00:00", lunchEnd: "23:59" }), true);
  assert.equal(isValidWorkConfig({ ...work, lunchStart: "12:59", lunchEnd: "13:00" }), true);
});

const invalidConfigs = [
  ["倒置午休", { lunchStart: "13:00", lunchEnd: "12:00" }],
  ["午休起止相同", { lunchStart: "12:00", lunchEnd: "12:00" }],
  ["小时超出范围", { lunchStart: "24:00" }],
  ["分钟超出范围", { lunchStart: "12:60" }],
  ["非法结束时间", { lunchEnd: "25:99" }],
  ["缺少开始时间", { lunchStart: undefined }],
  ["空结束时间", { lunchEnd: "" }],
  ["格式不完整", { lunchStart: "9:00" }],
  ["时间字段不是字符串", { lunchStart: 1200 }],
];

for (const [name, fields] of invalidConfigs) {
  test(`拒绝配置：${name}`, () => {
    assert.equal(isValidWorkConfig({ ...work, ...fields }), false);
  });
}

test("拒绝非对象配置", () => {
  for (const value of [null, undefined, "12:00", 60, {}]) {
    assert.equal(isValidWorkConfig(value), false);
  }
});
