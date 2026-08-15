# ZC 考勤加班统计

Tampermonkey 用户脚本：从公司考勤系统读取打卡记录（跨月份累积），对比正常工作时间计算加班。

## 安装 Tampermonkey

按浏览器安装扩展：

- Chrome / Edge（Chrome 商店）：[安装 Tampermonkey](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo)
- Edge（商店版）：[安装 Tampermonkey](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd)
- Firefox：[安装 Tampermonkey](https://addons.mozilla.org/en-US/firefox/addon/tampermonkey/)
- 其他浏览器（Safari、Opera 等）：访问[官网](https://www.tampermonkey.net/)下载

安装后确认工具栏出现 Tampermonkey 图标即可。

## 用法

1. 安装脚本（任选其一），Tampermonkey 会识别并安装：
   - 最新发布版：[安装 latest](https://github.com/paradox8599/zc-checkings/releases/latest/download/attendance.release.user.js)
   - 本地开发版：[安装 dev](http://localhost:8877/attendance.user.js)
2. 登录考勤系统，脚本在网站**任意页面**自动生效。
3. 浮动面板实时显示：出勤天数、平均工时、加班天数、总加班、每日明细（含工时与加班）。可通过面板切换月份、「获取」拉取数据，跨月份累积。

## 加班规则

通过面板「工作时段配置」按钮的表单设置（保存后立即生效并持久化）：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| 上班时间 | `08:30` | 正常上班时间 |
| 下班时间 | `17:30` | 正常下班时间 |
| 午休(分钟) | `0` | 午休时长（从工时中扣除，默认不扣） |
| 宽限(分钟) | `30` | 下班宽限，超出该分钟数才计加班 |
| 加班计算 | threshold | `threshold`=下班超过 标准下班+宽限 才计；`standard`=下班超过 标准下班 就计 |

配置保存在 localStorage（key `zc-attendance-work`）。「清空数据」按钮清空全部打卡记录。

## 构建

- `npm run build`：开发版，输出 `dist/core.js` + `dist/attendance.user.js`（stub），用于本地调试
- `npm run release`：发布版，输出 `dist/attendance.release.user.js`（27KB 自包含，core 内联、无本地服务依赖），**可直接拖入 Tampermonkey 安装**

## 本地调试工作流

一键启动开发环境：

```bash
npm run dev
```

自动完成：构建（watch 模式，改动 `src/*.ts` 自动重建）→ 起本地服务（8877）→ 启动独立 Chrome（临时 profile，自动加载 Tampermonkey 并安装 dev 版脚本）→ 打开考勤系统页面。

首次启动会下载 Tampermonkey 并安装脚本（耗时几秒）；之后复用 profile，秒开。后续改动只需刷新考勤系统页面即生效，无需在 Tampermonkey 里点更新。

Chrome 带 `--remote-debugging-port=9222`，AI 调试时用 `agent-browser --cdp 9222 <命令>` 连接（快照、点击、读控制台等）。

原理：`dist/attendance.user.js` 是零 `@grant` 的 stub（`@match` 真实考勤系统域名），`document-idle` 时 fetch `http://localhost:8877/core.js?t=<时间戳>`（时间戳绕过缓存）并直接 `eval`。build 时 esbuild 用 `define` 把 `GM_setValue`/`GM_getValue` 替换为 localStorage 读写函数（见 `build.mjs` 的 `banner`）。

## 目录结构

```
src/main.ts      入口：初始化、面板、数据获取、持久化、合并去重
src/api.ts       考勤 API 数据获取（fetchMonthAttendances）+ AttendanceRecord 类型
src/calc.ts      工时/加班纯计算
src/panel.ts     浮动面板 UI
build.mjs        esbuild 打包（支持 --watch）+ 生成 stub
dev.mjs          一键启动开发环境（build watch + 本地服务 + Chrome profile）
dist/            core.js（逻辑）+ attendance.user.js（stub）
```

## 依赖

- 本地调试：`npm run dev` 会自动准备一切（Tampermonkey 下载、临时 Chrome profile，见 `.dev/`）。
