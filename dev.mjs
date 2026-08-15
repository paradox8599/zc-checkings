import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";

const ROOT = resolve(import.meta.dirname);
const DEV_DIR = join(ROOT, ".dev");
const TM_DIR = join(DEV_DIR, "tampermonkey-beta");
const PROFILE_DIR = join(DEV_DIR, "chrome-profile");
const FLAG = join(DEV_DIR, "installed.flag");
const CRX_URL = "https://www.tampermonkey.net/crx/tampermonkey_beta_current.crx";
const SCRIPT_URL = "http://localhost:8877/attendance.user.js";
const SITE_URL = "http://61.174.171.59:9895/";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = 9222;

function prepareTampermonkey() {
  const ready = existsSync(join(TM_DIR, "manifest.json")) && existsSync(join(TM_DIR, "_locales"));
  if (ready) return;
  mkdirSync(DEV_DIR, { recursive: true });
  const crx = join(DEV_DIR, "tampermonkey-beta.crx");
  if (!existsSync(crx)) {
    spawnSync("curl", ["-fsSL", CRX_URL, "-o", crx], { stdio: "inherit" });
  }
  const buf = readFileSync(crx);
  if (buf.toString("latin1", 0, 4) !== "Cr24") throw new Error("crx 格式错误");
  const headerSize = buf.readUInt32LE(8);
  const zip = join(DEV_DIR, "tampermonkey.zip");
  writeFileSync(zip, buf.subarray(12 + headerSize));
  rmSync(TM_DIR, { recursive: true, force: true });
  mkdirSync(TM_DIR, { recursive: true });
  const r = spawnSync("unzip", ["-o", zip, "-d", TM_DIR], { stdio: "inherit" });
  if (r.status !== 0) throw new Error("unzip 失败");
  console.log("Tampermonkey 就绪:", TM_DIR);
}

function spawnService(cmd, args, name) {
  const p = spawn(cmd, args, { cwd: ROOT, stdio: "inherit" });
  p.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${name}] 异常退出 code=${code},dev 结束`);
      process.exit(1);
    }
  });
  return p;
}

async function waitHttp(url, timeoutMs = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`服务未就绪: ${url}`);
}

async function cdpReady() {
  try {
    const r = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    return r.ok;
  } catch {
    return false;
  }
}

async function cdpSend(wsUrl, method, params = {}) {
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("CDP 连接失败"));
  });
  try {
    return await new Promise((res, rej) => {
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.id === 1) m.error ? rej(new Error(m.error.message)) : res(m.result);
      };
      ws.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally {
    ws.close();
  }
}

async function loadTampermonkey() {
  const v = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const r = await cdpSend(v.webSocketDebuggerUrl, "Extensions.loadUnpacked", { path: TM_DIR });
  console.log("Tampermonkey 已加载 (id:", r.id + ")");
}

async function navigate(url) {
  const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = list.find((t) => t.type === "page");
  if (!page) throw new Error("无页面 target");
  await cdpSend(page.webSocketDebuggerUrl, "Page.navigate", { url });
}

let chromeProc = null;
process.on("SIGINT", () => {
  console.log("\n收尾...");
  if (chromeProc) {
    try {
      process.kill(chromeProc.pid, "SIGTERM");
    } catch {}
  }
  process.exit(0);
});

function launchChrome() {
  chromeProc = spawn(CHROME, [
    `--user-data-dir=${PROFILE_DIR}`,
    `--remote-debugging-port=${CDP_PORT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "about:blank",
  ], { stdio: "ignore", detached: true });
  chromeProc.unref();
}

async function main() {
  mkdirSync(DEV_DIR, { recursive: true });
  prepareTampermonkey();
  mkdirSync(PROFILE_DIR, { recursive: true });

  spawnSync("node", ["build.mjs"], { cwd: ROOT, stdio: "inherit" });
  spawnService("node", ["build.mjs", "--watch"], "build-watch");
  spawnService("node", ["test/serve-dist.mjs"], "serve-dist");
  await waitHttp(SCRIPT_URL);

  if (!(await cdpReady())) {
    launchChrome();
    const t0 = Date.now();
    while (!(await cdpReady())) {
      if (Date.now() - t0 > 20000) throw new Error("Chrome CDP 启动超时");
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  await loadTampermonkey();

  if (!existsSync(FLAG)) {
    await navigate(SCRIPT_URL);
    const rl = readline.createInterface({ input: stdin, output: stdout });
    console.log("首次安装:浏览器已打开脚本地址,Tampermonkey 会弹出安装确认");
    console.log("点击「安装」,然后回到这里按回车...");
    await rl.question("");
    rl.close();
    writeFileSync(FLAG, Date.now().toString());
    await navigate(SITE_URL);
    console.log("已记录安装,下次启动直接打开考勤系统");
  } else {
    await navigate(SITE_URL);
  }
  console.log("已打开", SITE_URL, "| 改 src/*.ts 自动重建,刷新页面即生效");
  console.log("调试:agent-browser --cdp 9222 <命令> 连接此 Chrome");

  await new Promise(() => {});
}

main().catch((e) => {
  console.error("dev 启动失败:", e.message);
  process.exit(1);
});
