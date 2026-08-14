import { build } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const isRelease = process.argv.includes("--release");
const version = "0.6.0";

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

const meta = `// @name         考勤加班统计
// @namespace    zc-checkings
// @version      ${version}
// @description  读取考勤API查询打卡数据，统计加班时长
// @match        http://61.174.171.59:9895/*
// @run-at       document-idle
`;

if (isRelease) {
  const core = readFileSync("dist/core.js", "utf8");
  const release = `// ==UserScript==
${meta}// ==/UserScript==

${core}`;
  writeFileSync("dist/attendance.release.user.js", release);
  console.log(`built dist/attendance.release.user.js (${(release.length / 1024) | 0}KB, 可直接安装到 Tampermonkey)`);
} else {
  const stub = `// ==UserScript==
${meta}// @match        http://localhost:8878/*
// @match        http://127.0.0.1:8878/*
// ==/UserScript==

(function () {
  fetch("http://localhost:8877/core.js?t=" + Date.now())
    .then(function (r) { return r.text(); })
    .then(function (code) {
      try {
        eval(code);
      } catch (e) {
        console.error("[考勤] core 执行失败: " + e.message);
      }
    })
    .catch(function (e) {
      console.error("[考勤] core 请求失败: " + e);
    });
})();
`;
  writeFileSync("dist/attendance.user.js", stub);
  console.log("built dist/core.js + dist/attendance.user.js (stub)");
}
