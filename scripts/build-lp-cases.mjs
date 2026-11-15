import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const casesRoot = join(root, "projects", "landing-pages", "cases");
const projects = JSON.parse(readFileSync(join(root, "projects", "landing-pages", "projects.json"), "utf8"));

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

// Regenerate presentation content inside the current shared shell. Preserve the
// header/player, language controls, asset versions and route navigation scripts.
function liveAction(project) {
  if (!project.liveUrl) return "";
  const label = project.status === "production" ? "Ver versão publicada" : "Abrir URL associada à campanha";
  return `<a class="button button-outline" href="${escapeHtml(project.liveUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}
function codeAction(project) {
  const label = project.status === "experiment" ? "Explorar o estudo" : "Explorar a página";
  return `<a class="button button-primary" href="demo/index.html">${label}</a>`;
}
function buildHtml(project, nextProject) {
  const path = join(casesRoot, project.slug, "index.html");
  const shell = readFileSync(path, "utf8");
  const copy = project.presentation;
  if (!copy) throw new Error(`Missing presentation copy: ${project.slug}`);
  const section = (number, label, title, text) => `<section class="case-section" aria-labelledby="story-${number}"><div class="case-section-title" data-reveal><p class="eyebrow">${String(number).padStart(2, "0")} / ${label}</p><h2 id="story-${number}">${title}</h2></div><div class="case-content" data-reveal><p>${escapeHtml(text)}</p></div></section>`;
  const main = `<main id="conteudo" tabindex="-1">
    <section class="lp-case-hero status-${escapeHtml(project.status)}" aria-labelledby="case-title">
      <div class="lp-case-hero-inner">
        <p class="eyebrow hero-enter">${escapeHtml(project.statusLabel)}</p>
        <h1 id="case-title" class="hero-enter">${escapeHtml(project.name)}</h1>
        <p class="case-lead hero-enter">${escapeHtml(copy.lead[0])}</p>
        <div class="case-actions hero-enter">${codeAction(project)}${liveAction(project)}</div>
      </div>
    </section>
    <dl class="case-meta" aria-label="Resumo do projeto"><div><dt>Minha atuação</dt><dd>Conteúdo, UX e desenvolvimento</dd></div><div><dt>Formato</dt><dd>Landing page responsiva</dd></div><div><dt>Status</dt><dd>${escapeHtml(project.statusLabel)}</dd></div></dl>
    ${section(1, "Contexto", "O ponto de partida", copy.context[0])}
    ${section(2, "Meu trabalho", "O que eu fiz", copy.work[0])}
    ${section(3, "Escolhas", "Como a página funciona", copy.choices[0])}
    <section class="case-section" aria-labelledby="preview-title">
      <div class="case-section-title" data-reveal><p class="eyebrow">04 / Na prática</p><h2 id="preview-title">Explore a interface</h2></div>
      <div class="case-content" data-reveal>
        <p>Você pode explorar o layout e as interações nesta prévia. Os formulários de contato estão desativados.</p>
        <div class="preview-frame"><iframe src="demo/index.html" title="Prévia da página: ${escapeHtml(project.name)}" loading="lazy"></iframe></div>
        <div class="case-actions">${codeAction(project)}${liveAction(project)}</div>
      </div>
    </section>
    <a class="case-next" href="../${escapeHtml(nextProject.slug)}/index.html"><span>Próximo case</span><strong>${escapeHtml(nextProject.name)}</strong></a>
  </main>`;
  return shell.replace(/<main\b[^>]*>[\s\S]*?<\/main>/, main)
    .replace(/(<meta (?:name="description"|property="og:description") content=")[^"]*/g, (_, prefix) => prefix + escapeHtml(copy.lead[0]));
}

for (let index = 0; index < projects.length; index += 1) {
  const project = projects[index];
  const next = projects[(index + 1) % projects.length];
  const dir = join(casesRoot, project.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), buildHtml(project, next), "utf8");

}

console.log(`Cases gerados: ${projects.length}`);
