import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = process.cwd();
const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const ARTIFACTS = join(ROOT, "artifacts", "browser-smoke");
const TEMP = mkdtempSync(join(tmpdir(), "programa-win-browser-"));
const TSX = join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const env = {
  ...process.env,
  NODE_ENV: "test",
  AUTH_TEST_MODE: "true",
  WIN_DECISION_APPROVER: "Aprovador Sintetico - browser smoke",
  DB_DRIVER: "pglite",
  DB_PGLITE_PATH: join(TEMP, "db"),
  PORT: String(PORT),
  APP_BASE_URL: BASE_URL,
  LOG_LEVEL: "silent",
};

function chromePath() {
  const candidates = [
    process.env.CHROME_BIN,
    process.platform === "win32" && join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    process.platform === "win32" && join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    process.platform === "win32" && join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  return candidates.find(existsSync) || null;
}

function runTs(script) {
  const result = spawnSync(process.execPath, [TSX, script], { cwd: ROOT, env, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${script} falhou com codigo ${result.status}`);
}

async function waitFor(url, attempts = 120) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timeout aguardando ${url}`);
}

async function assertAsset(path, expectedType) {
  const response = await fetch(`${BASE_URL}${path}`);
  const body = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "";
  if (!response.ok) throw new Error(`Asset ${path} respondeu HTTP ${response.status}`);
  if (!contentType.includes(expectedType)) throw new Error(`MIME inesperado em ${path}: ${contentType}`);
  if (body.byteLength < 100) throw new Error(`Asset ${path} chegou vazio ou truncado`);
}

async function cdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(message.error.message));
      else item.resolve(message.result);
    }
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.text);
    if (message.method === "Log.entryAdded" && message.params.entry.level === "error") {
      errors.push(message.params.entry.text);
    }
  });
  function send(method, params = {}) {
    const requestId = ++id;
    socket.send(JSON.stringify({ id: requestId, method, params }));
    return new Promise((resolve, reject) => pending.set(requestId, { resolve, reject }));
  }
  return { socket, send, errors };
}

async function evaluate(send, expression) {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitForApp(send) {
  for (let i = 0; i < 100; i += 1) {
    const ready = await evaluate(send,
      "Boolean(document.getElementById('appShell') && !document.getElementById('appShell').hidden)");
    if (ready) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("WIN Board nao ficou visivel no navegador");
}

async function waitForExpression(send, expression, message) {
  for (let i = 0; i < 100; i += 1) {
    if (await evaluate(send, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function screenshot(send, name) {
  const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(ARTIFACTS, name), Buffer.from(shot.data, "base64"));
}

async function run() {
  const chrome = chromePath();
  if (!chrome) throw new Error("Chrome/Chromium nao encontrado. Defina CHROME_BIN para executar o smoke real.");
  mkdirSync(ARTIFACTS, { recursive: true });
  runTs("src/db/cli-migrate.ts");
  runTs("src/db/cli-seed.ts");

  const server = spawn(process.execPath, [TSX, "src/main.ts"], { cwd: ROOT, env, stdio: "inherit" });
  await waitFor(`${BASE_URL}/healthz`);
  await assertAsset("/assets/win.css?v=0.3.0", "text/css");
  await assertAsset("/assets/win-boot.js?v=0.3.0", "javascript");
  await assertAsset("/assets/logo-locatelli-clara.png", "image/png");
  const chromeArgs = [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-port=9222", `--user-data-dir=${join(TEMP, "chrome")}`,
    `${BASE_URL}/`,
  ];
  if (typeof process.getuid === "function" && process.getuid() === 0) chromeArgs.unshift("--no-sandbox");
  const chromeProcess = spawn(chrome, chromeArgs, { stdio: "ignore" });

  try {
    const targets = await (await waitFor("http://127.0.0.1:9222/json")).json();
    const page = targets.find((target) => target.type === "page");
    if (!page) throw new Error("Aba do navegador nao encontrada");
    const { socket, send, errors } = await cdp(page.webSocketDebuggerUrl);
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Log.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1366, height: 768, deviceScaleFactor: 1, mobile: false,
    });
    await send("Page.navigate", { url: `${BASE_URL}/` });
    await waitForExpression(
      send,
      "Boolean(document.getElementById('authAction')) && !document.getElementById('authAction').hidden",
      "Tela de acesso local nao ficou pronta",
    );
    await screenshot(send, "desktop-login.png");
    await evaluate(send, "document.getElementById('authAction').click()");
    await waitForApp(send);
    const assetsReady = await evaluate(send,
      "getComputedStyle(document.body).backgroundColor !== 'rgba(0, 0, 0, 0)' && " +
      "document.querySelector('.app-brand img').naturalWidth > 0");
    if (!assetsReady) throw new Error("CSS ou logo nao foram aplicados no navegador");
    await screenshot(send, "desktop-map.png");

    await evaluate(send,
      "document.querySelector('.world-territory').dispatchEvent(" +
      "new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))");
    await waitForExpression(send, "Boolean(document.querySelector('.service-grid'))", "Territorio nao abriu");
    await evaluate(send, "document.querySelector('.service-button').click()");
    await waitForExpression(send, "Boolean(document.querySelector('.service-stage'))", "Servico nao abriu");
    await screenshot(send, "desktop-service.png");
    await evaluate(send, "document.getElementById('backMap').click(); document.getElementById('backMap').click()");

    for (const view of ["ranking", "achievements", "profile"]) {
      await evaluate(send, `document.querySelector('[data-view="${view}"]').click()`);
      const visible = await evaluate(send,
        `!document.querySelector('[data-view-panel="${view}"]').hidden && ` +
        `document.querySelector('[data-view-panel="${view}"]').innerText.trim().length > 30`);
      if (!visible) throw new Error(`View ${view} vazia ou invisivel`);
    }
    await screenshot(send, "desktop-profile.png");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    await evaluate(send, "document.querySelector('[data-view=\"map\"]').click()");
    const overflow = await evaluate(send, "document.documentElement.scrollWidth > document.documentElement.clientWidth");
    if (overflow) throw new Error("Overflow horizontal detectado no viewport movel");
    await screenshot(send, "mobile-map.png");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 1366, height: 768, deviceScaleFactor: 1, mobile: false,
    });
    await send("Page.navigate", { url: `${BASE_URL}/admin/` });
    await waitForExpression(
      send,
      "Boolean(document.getElementById('kpiReferrals')) && " +
        "document.getElementById('kpiReferrals').textContent.trim() !== '—'",
      "Painel administrativo nao terminou de carregar",
    );
    await screenshot(send, "desktop-admin.png");

    await send("Emulation.setDeviceMetricsOverride", {
      width: 390, height: 844, deviceScaleFactor: 1, mobile: true,
    });
    const adminOverflow = await evaluate(
      send,
      "document.documentElement.scrollWidth > document.documentElement.clientWidth",
    );
    if (adminOverflow) throw new Error("Overflow horizontal detectado no painel administrativo movel");
    await evaluate(send, "document.getElementById('mobileMenu').click()");
    const menuOpen = await evaluate(send, "document.body.classList.contains('menu-open')");
    if (!menuOpen) throw new Error("Menu movel do painel administrativo nao abriu");
    await screenshot(send, "mobile-admin.png");

    if (errors.length) throw new Error(`Erros do navegador: ${errors.join(" | ")}`);
    socket.close();
    console.log(`Browser smoke aprovado. Evidencias em ${ARTIFACTS}`);
  } finally {
    chromeProcess.kill();
    server.kill();
    rmSync(TEMP, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
