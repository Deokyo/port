import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const casesRoot = join(root, "projects", "landing-pages", "cases");
const projects = JSON.parse(readFileSync(join(root, "projects", "landing-pages", "projects.json"), "utf8"));
const base = "../../../../";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const escapeMarkdown = (value) => String(value ?? "").replaceAll("|", "\\|");

function list(items, className = "case-list") {
  return `<ul class="${className}">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function sourceNote(project) {
  if (!project.manifested) {
    return "Registro complementar do PROJECT_INDEX. Não faz parte das 12 entradas principais do manifest.";
  }
  return `Fonte verificada pelo manifest. SHA-256: ${project.sourceSha256}.`;
}

function liveAction(project) {
  if (!project.liveUrl) return "";
  const label = project.status === "production" ? "Ver versão publicada" : "Abrir URL associada à campanha";
  return `<a class="button button-outline" href="${escapeHtml(project.liveUrl)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

function codeAction(project) {
  const label = project.status === "experiment" ? "Ver código experimental" : "Abrir demo sanitizado";
  return `<a class="button button-primary" href="demo/index.html">${label}</a>`;
}

function buildHtml(project, nextProject) {
  const title = `${project.name} | Case de Diogo Mussi`;
  const url = `https://deokyo.github.io/port/projects/landing-pages/cases/${project.slug}/`;
  const manifestState = project.manifested ? "Entrada verificada no manifest" : "Registro complementar";
  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(project.summary)}">
  <meta name="robots" content="index,follow">
  <link rel="canonical" href="${url}">
  <meta property="og:type" content="article">
  <meta property="og:title" content="${escapeHtml(title)}">
  <meta property="og:description" content="${escapeHtml(project.summary)}">
  <meta property="og:image" content="https://deokyo.github.io/port/assets/images/landing-pages-system.webp">
  <link rel="stylesheet" href="${base}assets/styles.css">
  <script src="${base}assets/site.js" defer></script>
</head>
<body>
  <a class="skip-link" href="#conteudo">Ir para o conteúdo</a>
  <div class="scroll-progress" aria-hidden="true"><span id="scrollProgress"></span></div>
  <header class="site-header site-header-solid">
    <a class="site-mark" href="${base}index.html" aria-label="Voltar ao portfólio">DM.</a>
    <nav class="site-nav" aria-label="Navegação do case">
      <a href="../../index.html">Todos os cases</a>
      <a href="https://github.com/Deokyo" target="_blank" rel="noopener noreferrer">GitHub</a>
    </nav>
  </header>

  <main id="conteudo">
    <section class="lp-case-hero status-${escapeHtml(project.status)}" aria-labelledby="case-title">
      <div class="lp-case-hero-inner">
        <p class="eyebrow hero-enter">${escapeHtml(project.statusLabel)}</p>
        <h1 id="case-title" class="hero-enter">${escapeHtml(project.name)}</h1>
        <p class="case-lead hero-enter">${escapeHtml(project.summary)}</p>
        <div class="case-actions hero-enter">${codeAction(project)}${liveAction(project)}</div>
      </div>
    </section>

    <dl class="case-meta" aria-label="Resumo do projeto">
      <div><dt>Status</dt><dd>${escapeHtml(project.statusLabel)}</dd></div>
      <div><dt>Stack</dt><dd>HTML5, CSS3, JavaScript vanilla e RD Station</dd></div>
      <div><dt>Origem</dt><dd>${escapeHtml(manifestState)}</dd></div>
    </dl>

    <section class="case-section" aria-labelledby="context-title">
      <div class="case-section-title" data-reveal><p class="eyebrow">01 / Contexto</p><h2 id="context-title">Desafio</h2></div>
      <div class="case-content" data-reveal><p>${escapeHtml(project.context)}</p><h3>Objetivo da LP</h3><p>${escapeHtml(project.objective)}</p></div>
    </section>

    <section class="case-section" aria-labelledby="contribution-title">
      <div class="case-section-title" data-reveal><p class="eyebrow">02 / Atuação</p><h2 id="contribution-title">Contribuição técnica</h2></div>
      <div class="case-content" data-reveal>${list(project.contribution)}</div>
    </section>

    <section class="case-section" aria-labelledby="ux-title">
      <div class="case-section-title" data-reveal><p class="eyebrow">03 / Experiência</p><h2 id="ux-title">Decisões de UI/UX</h2></div>
      <div class="case-content" data-reveal>${list(project.ui)}</div>
    </section>

    <section class="case-section" aria-labelledby="technical-title">
      <div class="case-section-title" data-reveal><p class="eyebrow">04 / Código</p><h2 id="technical-title">Pontos técnicos</h2></div>
      <div class="case-content" data-reveal>${list(project.technical)}<div class="source-note"><strong>Proveniência</strong><p>${escapeHtml(sourceNote(project))}</p><code>${escapeHtml(project.sourcePath)}</code></div></div>
    </section>

    <section class="case-section" aria-labelledby="preview-title">
      <div class="case-section-title" data-reveal><p class="eyebrow">05 / Prévia</p><h2 id="preview-title">Código sanitizado</h2></div>
      <div class="case-content" data-reveal>
        <p>${escapeHtml(project.confidentiality)}</p>
        <div class="preview-frame"><iframe src="demo/index.html" title="Demonstração sanitizada: ${escapeHtml(project.name)}" loading="lazy"></iframe></div>
        <div class="case-actions">${codeAction(project)}${liveAction(project)}</div>
      </div>
    </section>

    <a class="case-next" href="../${escapeHtml(nextProject.slug)}/index.html"><span>Próximo case</span><strong>${escapeHtml(nextProject.name)}</strong></a>
  </main>

  <footer class="site-footer"><p>Diogo Mussi <span aria-hidden="true">/</span> ${escapeHtml(project.name)}</p><p>© <span data-current-year>2026</span></p></footer>
</body>
</html>
`;
}

function buildReadme(project) {
  const live = project.liveUrl
    ? `[${project.status === "production" ? "Versão publicada" : "URL associada à campanha"}](${project.liveUrl})`
    : "Não informada no pacote.";
  return `# ${project.name}

**Status:** ${project.statusLabel}  
**Stack:** HTML5, CSS3, JavaScript vanilla, responsive design e RD Station  
**Fonte:** \`${project.sourcePath}\`  
**Manifest:** ${project.manifested ? `verificado pelo SHA-256 \`${project.sourceSha256}\`` : "registro complementar do PROJECT_INDEX"}

## Contexto e desafio

${project.context}

## Objetivo da LP

${project.objective}

## Minha contribuição técnica

${project.contribution.map((item) => `- ${escapeMarkdown(item)}`).join("\n")}

## Principais decisões de UI/UX

${project.ui.map((item) => `- ${escapeMarkdown(item)}`).join("\n")}

## Pontos técnicos

${project.technical.map((item) => `- ${escapeMarkdown(item)}`).join("\n")}

## Prévia e código

- [Abrir a cópia sanitizada](demo/index.html)
- ${live}

## Observação

${project.confidentiality}

Não há métricas de conversão ou impacto atribuídas a este case sem evidência pública comparável.
`;
}

for (let index = 0; index < projects.length; index += 1) {
  const project = projects[index];
  const next = projects[(index + 1) % projects.length];
  const dir = join(casesRoot, project.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), buildHtml(project, next), "utf8");
  writeFileSync(join(dir, "README.md"), buildReadme(project), "utf8");
}

console.log(`Cases gerados: ${projects.length}`);
