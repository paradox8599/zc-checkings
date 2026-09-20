# ZC 考勤加班统计

Tampermonkey 用户脚本：从公司考勤系统读取打卡记录（跨月份累积），对比正常工作时间计算加班。

## 安装 Tampermonkey（Beta）

建议使用 **Tampermonkey Beta**（Stable 版在部分 Chrome 版本上存在安装流程兼容问题，Beta 版更稳定）：

- Chrome / Edge：打开 [Tampermonkey Beta 页面](https://www.tampermonkey.net/beta.php)，下载对应浏览器的 `tampermonkey_beta_current.crx`，拖入 `chrome://extensions`（需开启「开发者模式」）安装
- Firefox：[安装 Tampermonkey Beta](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey-beta/)
- 其他浏览器：访问[官网](https://www.tampermonkey.net/)查看支持情况

安装后确认工具栏出现 Tampermonkey 图标即可。若脚本在页面上不生效，需在 `chrome://extensions` 中开启 Tampermonkey Beta 的「允许用户脚本」（Allow User Scripts）开关。

## 用法

1. 安装脚本（任选其一），Tampermonkey 会识别并安装：
   - 最新发布版：[安装 latest](https://github.com/paradox8599/zc-checkings/releases/latest/download/attendance.release.user.js)
   - 本地开发版：[安装 dev](http://localhost:8877/attendance.user.js)
2. 登录考勤系统，脚本在网站**任意页面**自动生效。
3. 浮动面板实时显示：出勤天数、平均工时、加班天数、总加班、每日明细（含工时与加班）。可通过面板切换月份、「获取」拉取数据，跨月份累积。
4. 面板分「加班统计」「请假台账」两个 tab：在台账 tab 录入请假，自动按加班抵扣算出结余，并可一键生成抵扣声明。

## 加班规则

算法固定，面板「设置」里只有午休时长可调（保存后立即生效并持久化）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| 午休(分钟) | `60` | 午休时长，每天从打卡时长里扣除 |

扣除午休之后：

- **工作日**：工时超过 8 小时的部分算加班
- **周末**：工时本身就是加班，最多算 8 小时（不超过一个标准工作日）
- **不足 60 分钟不计**：算出来不足 1 小时时，当天整天不算加班

配置保存在 localStorage（key `zc-attendance-work`）。「清空数据」按钮清空全部打卡记录。

## 请假台账

在加班统计之上叠加「请假抵扣」，算出当前加班结余，并能生成抵扣声明。

**数据**

- 加班：由插件实时算出 `{日期, 加班分钟}`，不落库
- 每月修正：用来对齐「插件算出来的数」和「已提交的加班表」。在「加班统计」tab 选中年份、月份后，表头右侧的「修正」框可对**该月加班总额**加减一个分钟数（可为负，填 `0` 即清除）；存 localStorage（key `zc-month-adjust`），形如 `{"2026-08": 32}`。修正在抵扣池里单独成条，不占用某一天
- 已上报月份：只有上报给公司的加班才能用来抵扣请假。在「加班统计」tab 的表头勾选「已上报」，该月的加班和修正才计入可抵扣时间；存 localStorage（key `zc-month-reported`），形如 `["2026-08"]`。没勾的月份不计入抵扣池，只在台账里以「未上报」单列
- 加班起算日期：早于此日期的加班不计入抵扣池（含当天）；存 localStorage（key `zc-leave-start`），默认 `2026-08-01`，在台账 tab 顶部可改
- 请假记录：`{id, 日期, 开始时间, 结束时间, 事由}`，存 localStorage（key `zc-leave-records`）；时长由开始、结束时间相减得出，不单独填

**抵扣规则**

加班没有有效期。抵扣按下式现算，不落库：

1. 只有勾了「已上报」的月份才进抵扣池，未上报的月份不参与抵扣
2. 加班按日期从早到晚排；当月修正排在该月所有加班日之后
3. 请假也按日期从早到晚排
4. 依次把每笔请假的时长，从最早那笔加班开始扣，一笔不够就顺延到下一笔
5. 每笔加班的「此前已抵扣 / 本次抵扣 / 该笔剩余」，取的是这笔请假发生时的快照
6. 累计加班 ＝ Σ已上报加班 ＋ Σ未上报加班；已上报 ＝ Σ已上报加班，也就是可抵扣时间；结余 ＝ 已上报 − Σ请假时长
7. 负数修正不做抵扣，而是从该月起冲减最早的可抵扣加班，声明里单独注明

**声明**

每笔请假可生成一段「加班抵扣说明」，直接贴进请假单的事由栏。

## 构建

依赖用 pnpm 管理，先 `pnpm install`：

- `pnpm run build`：开发版，输出 `dist/core.js` + `dist/attendance.user.js`（stub），用于本地调试
- `pnpm run release`：发布版，输出 `dist/attendance.release.user.js`（27KB 自包含，core 内联、无本地服务依赖），**可直接拖入 Tampermonkey 安装**

## 本地调试工作流

一键启动开发环境：

```bash
pnpm run dev
```

自动完成：构建（watch 模式，改动 `src/*.ts` 自动重建）→ 起本地服务（8877）→ 启动独立 Chrome（临时 profile，自动加载 Tampermonkey Beta 并安装 dev 版脚本）→ 打开考勤系统页面。

首次启动会下载 Tampermonkey 并安装脚本（耗时几秒）；之后复用 profile，秒开。后续改动只需刷新考勤系统页面即生效，无需在 Tampermonkey 里点更新。

Chrome 带 `--remote-debugging-port=9222`，AI 调试时用 `agent-browser --cdp 9222 <命令>` 连接（快照、点击、读控制台等）。

原理：`dist/attendance.user.js` 是零 `@grant` 的 stub（`@match` 真实考勤系统域名），`document-idle` 时 fetch `http://localhost:8877/core.js?t=<时间戳>`（时间戳绕过缓存）并直接 `eval`。build 时 esbuild 用 `define` 把 `GM_setValue`/`GM_getValue` 替换为 localStorage 读写函数（见 `build.mjs` 的 `banner`）。

## 目录结构

```
src/main.ts      入口：初始化、面板、数据获取、持久化、合并去重
src/api.ts       考勤 API 数据获取（fetchMonthAttendances）+ AttendanceRecord 类型
src/calc.ts      工时/加班纯计算
src/ledger.ts    请假抵扣台账：FIFO 抵扣 + 声明文本生成
src/panel.ts     浮动面板 UI
build.mjs        esbuild 打包（支持 --watch）+ 生成 stub
dev.mjs          一键启动开发环境（build watch + 本地服务 + Chrome profile）
dist/            core.js（逻辑）+ attendance.user.js（stub）
```

## 依赖

- 本地调试：`pnpm run dev` 会自动准备一切（Tampermonkey 下载、临时 Chrome profile，见 `.dev/`）。
