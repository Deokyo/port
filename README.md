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

Fontes dos projetos revisadas em 12 de novembro de 2026. Os cases públicos apresentam contexto, atuação e entregas. Os registros de versão e
validação são documentação do projeto; esta revisão não equivale à homologação dos produtos.

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

Project sources reviewed on November 12, 2026. Public case studies present context, contribution and deliverables. Version and validation
records are project documentation; this review does not certify product readiness.

## Local

PT: abra `index.html` no navegador ou execute:

EN: open `index.html` in your browser or run:

```bash
python -m http.server 8080
```

Verificação opcional / Optional check: `node scripts/check-site.mjs`.

## Uso / Usage

PT: trabalhos autorizados e sanitizados, sem dados pessoais nem integrações ativas.

Tracking: apenas as páginas do próprio portfólio (home, páginas de projeto e páginas de case) usam Google Tag Manager e Umami, para medir a audiência do portfólio. As demos independentes (`projects/landing-pages/cases/*/demo/`) não têm nenhum tracking e não devem receber tags. Os identificadores pertencem a este site e não devem ser copiados para materiais de clientes.

EN: authorized, sanitized work without personal data or active integrations.

Tracking: only the portfolio's own pages (home, project pages, and case pages) use Google Tag Manager and Umami, to measure portfolio audience. The standalone demos (`projects/landing-pages/cases/*/demo/`) have no tracking and must not receive tags. The identifiers belong to this site and must not be copied into client materials.

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

Player de áudio na página inicial com quatro faixas locais, disco animado e controles de
play, pausa, parada, volume, posição e troca de faixa. Começa recolhido ao lado do logo;
o painel abre abaixo da navegação e fecha com Escape ou clique fora.

O player tenta iniciar ao abrir a página, com volume de 5%, sem depender do Spotify.
Navegadores que bloqueiam autoplay com som exibem “Toque no play”, sem forçar a reprodução.
A faixa inicial segue um sorteio das quatro músicas, sem repetições até completar o ciclo
e sem repetir a última abertura ao começar o próximo. A fila é guardada apenas no
`localStorage` deste navegador; se o armazenamento estiver indisponível, o sorteio continua
sem histórico entre visitas. A próxima faixa toca ao terminar a atual. Pausar ou parar interrompe
a reprodução real e a animação. A música continua durante a navegação pela página e
com a aba em segundo plano, conforme as restrições do navegador. Movimento reduzido
mantém o disco estático. Sem JavaScript, o player fica oculto.

Ordem das faixas fornecidas:

1. Blood Magic — Daniel Deluxe
2. Shattered Memories — Navjaxx, VXLLAIN
3. You Can't Run From Me — Rico Nasty
4. I Really Want to Stay at Your House — Rosa Walton

Os MP3s são cópias sem alterações dos arquivos fornecidos. Shattered Memories foi
remuxada do contêiner MP4 para M4A com cópia do fluxo AAC, sem recodificação.
Os arquivos em `assets/audio/` não recebem licença aberta por este repositório.

## Texturas

O portfólio e os cases usam circuitos vetoriais nas margens, curvas topográficas nos
painéis de abertura e retícula estática em áreas de destaque. Os SVGs locais em
`assets/images/textures/` e `assets/textures.css` não adicionam scripts, animações ou
serviços externos. O modo de cores forçadas remove as texturas. As demos de clientes
preservam seus estilos próprios.

## Ícones retrô e continuidade do fundo

Ícones SVG locais de prédio, globo, computador, constelação e órbita identificam os contextos
da página inicial. São decorativos, com os nomes dos projetos e destinos preservados
em texto. O Prumo mantém o “P.” original. As setas dos links usam um desenho em pixels.

O padrão de circuitos conecta as bordas opostas do tile nas mesmas coordenadas e
direções. O cabeçalho e os resumos das pastas não reiniciam esse padrão, evitando
emendas entre superfícies que se movem de forma independente.

O circuito contínuo usa o arquivo `circuit-grid-seamless.svg`, com uma URL distinta
do padrão anterior para impedir a reutilização do SVG antigo em cache.

## Idiomas e navegação

O seletor PT/EN traduz a página inicial, o diretório e os cases, incluindo metadados,
textos alternativos e controles do player. Na primeira visita, usa o idioma do navegador
(PT para português, EN para os demais); a escolha manual fica no localStorage e pode
ser compartilhada com `?lang=pt` ou `?lang=en`. Não usa geolocalização, cookies ou
serviços externos de tradução. As demos dos clientes mantêm os idiomas originais.

A navegação entre as 18 páginas do portfólio preserva o cabeçalho e o mesmo elemento
de áudio, trocando somente o conteúdo e o rodapé. Voltar/avançar usa o histórico do
navegador; links de imagens e demos são resolvidos pelo endereço de cada case. As demos
e avisos abrem em outra aba para preservar a música. Recarregar a página inteira ainda
recria o player e segue as regras de autoplay do navegador. Sem JavaScript, as páginas
em português e os links normais continuam disponíveis.

Para manter o cabeçalho comum, alterações no cabeçalho devem ser replicadas nos HTMLs
do portfólio. Demos de clientes não usam esse cabeçalho.

## Textos dos cases / Case study copy

A apresentação pública usa primeira pessoa e prioriza problema, atuação, escolhas e entrega.
Versões, auditoria técnica e próximos passos internos ficam na documentação. Resultados de
negócio só entram com dados que possam ser publicados; a revisão atual não atribui ganhos
de conversão, receita, adoção ou tempo economizado.

Nas LPs, `projects/landing-pages/projects.json` preserva os registros de origem e contém
`presentation` com pares PT/EN. `node scripts/build-lp-cases.mjs` atualiza o conteúdo dentro
do shell existente, preservando player, idioma e navegação. As traduções dos textos novos
devem acompanhar a edição em `assets/language.js`. As demos mantêm o conteúdo dos projetos.

Public copy uses first person and focuses on the problem, contribution, choices and
deliverable. Internal technical records stay in documentation. No business outcome is
claimed without shareable evidence. Landing page presentation copy is stored as PT/EN
pairs in `projects.json`; the builder preserves the current shared shell. Update the
language dictionary alongside edits. Demos keep the original project content.

## Resultados das LPs / Landing page results

A seção `projects/landing-pages/index.html#resultados` apresenta os agregados aprovados
para o recorte de seis LPs de serviços: +18,6% na média diária de envios e 76% dos envios
posteriores com uma frente de serviço indicada. O bloco nativo `details` contém períodos,
fórmulas, regras de composição e limitações, incluindo a razão de envios por visitante.
Eventos ficam fora desse comparativo. Fontes com dados pessoais e volumes absolutos
não integram o repositório. A seção e os atalhos possuem traduções PT/EN e funcionam
na navegação persistente do player; sem JavaScript, o conteúdo e a expansão continuam acessíveis.

The results section presents aggregate service-page metrics, with scope and calculations
in a native disclosure. Source exports and personal data are not included in this repository.
