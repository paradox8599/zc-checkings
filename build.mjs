import { build } from "esbuild";
import { writeFileSync } from "node:fs";

await build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/core.js",
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "none",
  define: {
    GM_setValue: "__zcSet",
    GM_getValue: "__zcGet",
  },
  banner: {
    js: `var __zcSet = function (k, v) { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); };\nvar __zcGet = function (k, d) { var r = localStorage.getItem(k); return r == null ? d : r; };`,
  },
});

const stub = `// ==UserScript==
// @name         EMERGEN 考勤加班统计
// @namespace    zc-checkings
// @version      0.6.0
// @description  读取考勤日历 DOM，手动翻页累积并持久化打卡数据，统计加班时长（本地调试版）
// @match        http://61.174.171.59:9895/*
// @match        http://localhost:8878/*
// @match        http://127.0.0.1:8878/*
// @run-at       document-idle
// ==/UserScript==

(function () {
  fetch("http://localhost:8877/core.js?t=" + Date.now())
    .then(function (r) { return r.text(); })
    .then(function (code) {
      try {
        eval(code);
      } catch (e) {
        console.error("[EMERGEN] core 执行失败: " + e.message);
      }
    })
    .catch(function (e) {
      console.error("[EMERGEN] core 请求失败: " + e);
    });
})();
`;

writeFileSync("dist/attendance.user.js", stub);
console.log("built dist/core.js + dist/attendance.user.js (stub)");
