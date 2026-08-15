# ZC 考勤加班统计

Tampermonkey 用户脚本：从公司考勤日历页面读取打卡记录（手动翻月累积），对比正常工作时间计算加班。

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
2. 登录考勤系统，进入「考勤日历」tab。
3. **手动翻月**（通过年月选择器切换月份），脚本自动抓取当前页面的打卡数据并持久化到 localStorage，跨月份累积。
4. 浮动面板实时显示：出勤天数、平均工时、加班天数、总加班、每日明细（含工时与加班）。

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

改动 `src/*.ts` 后只需 `node build.mjs`，再刷新页面即生效——无需在 Tampermonkey 里点更新。

原理：`dist/attendance.user.js` 是零 `@grant` 的 stub，`document-idle` 时 fetch `http://localhost:8877/core.js?t=<时间戳>`（时间戳绕过缓存）并直接 `eval`。build 时 esbuild 用 `define` 把 `GM_setValue`/`GM_getValue` 替换为 localStorage 读写函数（见 `build.mjs` 的 `banner`）。

## 目录结构

```
src/main.ts      入口：初始化、面板、DOM 扫描、持久化、合并去重
src/dom.ts       硬编码考勤日历 DOM 解析（.ant-fullcalendar-* 结构）
src/calc.ts      工时/加班纯计算
src/panel.ts     浮动面板 UI
build.mjs        esbuild 打包 + 生成 stub
dist/            core.js（逻辑）+ attendance.user.js（stub）
test/            mock 考勤服务器（开发用）
```

## 依赖

- 本地调试需要 `http://localhost:8877` 服务 `dist/` 目录（`node test/serve-dist.mjs`）。
- mock 测试：`node test/mock-api.cjs`（端口 8878）。
