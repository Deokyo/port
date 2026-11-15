# Diogo Mussi

## Português

Portfólio pessoal de Growth, UX e engenharia de produto. Trabalhos profissionais e estudos
independentes possuem contextos identificados.

- [Programa WIN](projects/programa-win/index.html): produto interno gamificado com mapa,
  ranking, conquistas e painel administrativo; baseline local 0.3.1, sem homologação comprovada.
- [Landing Pages Locatelli](projects/landing-pages/index.html): cases de produção, testes A/B,
  demos e experimentos identificados por status.
- [Prumo](projects/prumo/index.html): projeto pessoal de estudo, sem vínculo com a Locatelli Group;
  copiloto Android experimental 0.3.0 com análise de
  ofertas, jornada e relatórios Excel; validação em aparelho pendente.
- [Project Atlas](projects/project-atlas/index.html): protótipo visual v0.3 com dados
  sintéticos, sem conectores operacionais.

Fontes dos projetos revisadas em 12 de novembro de 2026. Versões e limites são apresentados
nos cases; esta revisão não equivale à homologação dos produtos.

## English

Growth, UX, and product engineering portfolio.

- [WIN Program](projects/programa-win/index.html): an internal gamified product featuring a
  territory map, rankings, achievements, and an admin dashboard; local baseline 0.3.1,
  without verified acceptance testing for that baseline.
- [Locatelli Landing Pages](projects/landing-pages/index.html): production case studies, A/B
  tests, demos, and clearly labeled experiments.
- [Prumo](projects/prumo/index.html): a personal study project with no affiliation with Locatelli Group;
  experimental Android copilot 0.3.0 with offer analysis,
  work sessions, and Excel reports; device validation remains pending.
- [Project Atlas](projects/project-atlas/index.html): visual prototype v0.3 using synthetic
  data, with no operational connectors.

Project sources reviewed on November 12, 2026. Versions and limitations are documented in
each case; this review does not certify product readiness.

## Local

PT: abra `index.html` no navegador ou execute:

EN: open `index.html` in your browser or run:

```bash
python -m http.server 8080
```

Verificação opcional / Optional check: `node scripts/check-site.mjs`.

## Uso / Usage

PT: trabalhos autorizados e sanitizados, sem dados pessoais, tracking ou integrações ativas.

EN: authorized, sanitized work without personal data, tracking, or active integrations.

Materiais de clientes não possuem licença aberta / Client materials are not openly licensed.
Consulte / See [NOTICE.md](NOTICE.md).

## Identidade visual / Visual identity

PT: direção retrô cyberpunk, com Roguepunk licenciada para uso no site e carregada
localmente nos destaques. O arquivo e seu aviso original estão em `assets/fonts/`.
A licença de uso não é transferida a terceiros pelo repositório.

EN: retro cyberpunk direction with Roguepunk licensed for site use and loaded locally
for display text. The font and original notice are in `assets/fonts/`.
The usage license is not transferred to third parties through this repository.

PT: a ilustração atmosférica `afterhours-city.webp` foi gerada com IA para a identidade do
portfólio; não é apresentada como trabalho entregue a um cliente. As imagens dos cases e
as demos dos clientes preservam suas identidades originais.

EN: `afterhours-city.webp` is an AI-generated atmospheric illustration for the portfolio's
identity, not a client deliverable. Case images and client demos retain their original identities.

Prévias desta direção / Art direction previews:
[Desktop](docs/previews/retro-desktop.webp) · [Mobile](docs/previews/retro-mobile.webp) ·
[Cena animada / Motion preview](docs/previews/retro-motion.webm).

PT: `scene-background.webp` e `scene-cat.webp` são camadas geradas com IA a partir da
ilustração original. A cena da abertura combina cenário e gato em camadas registradas. A cauda se move,
os olhos piscam, a chuva tem duas profundidades e as lanternas traseiras ficam acesas.
O controle pausa todas as animações; movimento reduzido começa parado e exige ativação
explícita. Fora da tela ou com a aba oculta, a cena pausa. Sem JavaScript, a composição
permanece estática e visível.

EN: `scene-background.webp` and `scene-cat.webp` are AI-generated layers derived from the
original illustration. The hero uses registered background and cat layers. The tail sways, the eyes blink,
rain has two depths, and rear lamps glow. The control pauses every animation. Reduced
motion starts paused and requires explicit opt-in. The scene pauses offscreen or in hidden
tabs; without JavaScript, the composition remains visible and static.

## Organização / Organization

PT: os trabalhos profissionais ficam em pastas por empresa. A pasta Locatelli Group reúne
Marketing & aquisição (a coleção de landing pages, com atalhos para produção, A/B e demos)
e Produtos internos (Programa WIN e Project Atlas). Os estudos pessoais permanecem separados.
As pastas usam `details`/`summary`, funcionam por teclado e não dependem de JavaScript.
Novas empresas podem seguir a mesma estrutura, sem criar categorias vazias na interface.

EN: professional work is grouped by company. Locatelli Group contains Marketing & acquisition
(the landing-page collection, with production, A/B, and demo shortcuts) and Internal products
(Programa WIN and Project Atlas). Personal studies stay separate. Native `details`/`summary`
folders support keyboard use and work without JavaScript. Additional companies can use the
same structure without showing empty categories.

## Sound bar

Player visual cyberpunk ao lado do logo no cabeçalho, com disco ilustrado, controles analógicos,
modo recolhido inicial e navegação entre três faixas demonstrativas. O painel expandido
abre abaixo do cabeçalho; Escape ou um clique fora recolhe os controles. A interface identifica
“DEMO · SEM ÁUDIO”: não há arquivo de música, streaming ou reprodução automática.
O disco anima apenas após interação; movimento reduzido mantém o disco estático.
Fora da tela ou com a aba oculta, a demonstração pausa. Sem JavaScript, o player fica oculto.
Os ícones SVG e a ilustração são servidos pelo próprio repositório, sem dependências externas.
