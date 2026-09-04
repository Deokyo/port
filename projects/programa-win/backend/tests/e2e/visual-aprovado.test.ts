import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createTestContext, type TestContext } from "../helpers/app";

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
afterAll(async () => { await ctx.close(); });

const page = () => readFileSync("web/index.html", "utf8");
const boot = () => readFileSync("web/assets/win-boot.js", "utf8");
const adminPage = () => readFileSync("web/admin/index.html", "utf8");
const adminScript = () => readFileSync("web/assets/admin.js", "utf8");
const adminCss = () => readFileSync("web/assets/styles.css", "utf8");
const launcher = () => readFileSync("INICIAR-WIN.bat", "utf8");
const serverSource = () => readFileSync("src/http/server.ts", "utf8");

describe("Contrato visual do WIN Board", () => {
  it("serve apenas assets locais compativeis com a CSP", async () => {
    const html = page();
    expect(html).not.toMatch(/<style[\s>]/i);
    expect(html).not.toMatch(/<script(?![^>]*\ssrc=)/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).not.toContain("style=");
    expect(html).toContain("/assets/win.css?v=0.3.0");
    expect(html).toContain("/assets/win-boot.js?v=0.3.0");
    for (const path of [
      "/assets/win.css", "/assets/win-boot.js", "/assets/logo-locatelli-clara.png",
      "/assets/BASE_IMPORTACAO_WIN.xlsx",
    ]) {
      const response = await ctx.app.inject({ method: "GET", url: path });
      expect(response.statusCode, path).toBe(200);
      expect(response.rawPayload.byteLength, path).toBeGreaterThan(100);
    }
  });

  it("nao carrega a engine demonstrativa antiga", () => {
    expect(page()).not.toContain("/assets/win.js");
    expect(boot()).not.toContain("window.WIN_DATA");
  });

  it("nao contem taxonomia, pessoas ou metricas fixas do prototipo", () => {
    const content = page() + boot();
    for (const forbidden of [
      "BPO", "Ploomes", "6.420", "42%", "67%", "5 de 6", "Explorador",
      "580 pontos", "Trocar foto", "Salvar anotação", "diogo@demonstracao",
    ]) {
      expect(content, forbidden).not.toContain(forbidden);
    }
  });

  it("renderiza quatro formas a partir dos territorios retornados pela API", () => {
    expect(boot()).toContain("territories.slice(0, MAP_SHAPES.length)");
    expect(boot()).toContain("var MAP_SHAPES = [");
    expect((boot().match(/\{ d: \"M/g) ?? [])).toHaveLength(4);
    expect(boot()).toContain('state.mapLevel = "territory"');
    expect(boot()).toContain('state.mapLevel = "service"');
    expect(boot()).toContain('/api/v1/me/referrals?pageSize=50');
  });

  it("estados pendentes substituem dados inventados", () => {
    const content = page() + boot();
    expect(content).toContain("Ranking aguardando aprovacao");
    expect(content).toContain("Conquistas aguardando regra");
    expect(content).toContain("Identidade nao vinculada");
  });

  it("visitante recebe somente a casca e APIs continuam protegidas", async () => {
    const html = await ctx.app.inject({ method: "GET", url: "/" });
    const board = await ctx.app.inject({ method: "GET", url: "/api/v1/board/summary" });
    expect(html.statusCode).toBe(200);
    expect(board.statusCode).toBe(401);
  });

  it("o login local so existe em modo de teste", async () => {
    const anonymous = await ctx.app.inject({ method: "GET", url: "/api/v1/auth/session" });
    expect(anonymous.statusCode).toBe(200);
    expect(anonymous.json()).toMatchObject({
      authenticated: false,
      localLoginAvailable: true,
      loginUrl: "/auth/test-login/local",
    });
    expect(page()).toContain('class="login-screen"');
    const response = await ctx.app.inject({ method: "GET", url: "/auth/test-login/local" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe("/");
    expect(response.cookies.some((cookie) => cookie.name === "win_session")).toBe(true);
  });

  it("apos o login, assets e APIs concorrentes nao bloqueiam o PGlite local", async () => {
    const login = await ctx.app.inject({ method: "GET", url: "/auth/test-login/local" });
    const session = login.cookies.find((cookie) => cookie.name === "win_session");
    expect(session).toBeTruthy();
    const cookie = `win_session=${session!.value}`;

    const assets = await Promise.all([
      "/assets/win.css?v=0.3.0",
      "/assets/win-boot.js?v=0.3.0",
      "/assets/logo-locatelli-clara.png",
    ].map((url) => ctx.app.inject({ method: "GET", url, headers: { cookie } })));
    expect(assets.every((response) => response.statusCode === 200)).toBe(true);
    expect(assets.every((response) => response.headers["cache-control"] === "no-store")).toBe(true);

    const apiResponses = await Promise.all([
      "/api/v1/auth/session",
      "/api/v1/board/summary",
      "/api/v1/board/me",
      "/api/v1/me/achievements",
      "/api/v1/me/notifications",
      "/api/v1/me/referrals?pageSize=50",
    ].map((url) => ctx.app.inject({ method: "GET", url, headers: { cookie } })));
    expect(apiResponses.every((response) => response.statusCode === 200)).toBe(true);
  });

  it("o launcher usa um unico host e so abre depois dos assets reais", () => {
    expect(launcher()).toContain('APP_BASE_URL=http://127.0.0.1:%PORT%');
    expect(launcher()).not.toContain("http://localhost");
    expect(launcher()).toContain("/assets/win.css?v=0.3.0");
    expect(launcher()).toContain("/assets/win-boot.js?v=0.3.0");
    expect(launcher()).toContain("/assets/logo-locatelli-clara.png");
    expect(serverSource()).toContain('setHeaders: (reply) => reply.header(');
  });

  it("o painel usa o logo oficial e os mesmos seletores de interacao definidos no CSS", () => {
    expect(adminPage()).toContain("/assets/logo-locatelli-clara.png");
    expect(adminPage()).toContain("/assets/styles.css?v=0.3.0");
    expect(adminPage()).toContain("/assets/admin.js?v=0.3.0");
    expect(adminScript()).toContain('track.className = "funnel-bar"');
    expect(adminCss()).toContain(".funnel-bar");
    expect(adminScript()).toContain('classList.toggle("menu-open")');
    expect(adminCss()).toContain("body.menu-open .sidebar");
    expect(adminScript()).toContain('classList.toggle("sidebar-collapsed")');
    expect(adminCss()).toContain("body.sidebar-collapsed");
  });
});
