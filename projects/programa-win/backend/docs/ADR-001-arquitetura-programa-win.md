# ADR-001 — Arquitetura do Programa WIN

- **Status:** aceito (reversível)
- **Data:** 03/09/2026
- **Decisor técnico:** implementação desta entrega
- **Revisão obrigatória:** quando o repositório do "sistema atual" for disponibilizado (D-01)

---

## 1. Contexto

O material recebido é um protótipo client-side: HTML, CSS e JavaScript puro, sem backend,
banco, autenticação, APIs ou testes. A orientação de negócio existente é manter o Programa
WIN **dentro de uma única aplicação**, com área administrativa protegida, evitando duas
identidades ou dois sistemas divergentes.

O repositório do "sistema atual" mencionado no briefing **não foi entregue**. Portanto esta
decisão não pode ser uma decisão de integração; é uma decisão de construção com ponto de
reconciliação previsto.

## 2. Decisão

Construir **uma aplicação única** que serve o WIN Board público-interno e a área `/admin`
a partir do mesmo processo, do mesmo banco e do mesmo modelo de autorização.

### Stack

| Camada          | Escolha                          | Versão instalada |
| --------------- | -------------------------------- | ---------------- |
| Runtime         | Node.js                          | 22.x (mínimo 20.11) |
| Linguagem       | TypeScript (ESM, `strict`)       | 6.0              |
| HTTP            | Fastify                          | 5.x              |
| Plugins HTTP    | `@fastify/cookie`, `helmet`, `multipart`, `rate-limit`, `static` | 10–13.x |
| Validação       | Zod                              | 4.x              |
| Banco           | PostgreSQL                       | 18 (via PGlite em dev/test) |
| Driver produção | `pg`                             | 8.x              |
| Banco embarcado | `@electric-sql/pglite`           | 0.5.x            |
| JWT/OIDC        | `jose` + fluxo Authorization Code + PKCE escrito à mão | 6.x |
| Testes          | Vitest                           | 4.x              |
| Lint            | ESLint + typescript-eslint       | 10.x / 8.x       |
| Execução        | `tsx`                            | 4.x              |

### Princípios estruturais

1. **Frontend e backend separados por responsabilidade, não por deploy.** `web/` contém
   HTML/CSS/JS servidos pelo mesmo processo; `src/` contém o servidor. Um build SPA foi
   descartado por não trazer benefício ao escopo e por descartar a identidade visual pronta.
2. **O banco é a autoridade.** Pontuação, identidade, catálogo e estado de indicação vivem
   no PostgreSQL. O navegador nunca é fonte de verdade e nunca persiste dado pessoal.
3. **Nega por padrão.** Toda rota declara `public: true` ou uma permissão. Um teste de
   integração falha se alguma rota ficar sem política.
4. **Defesa em profundidade.** A autorização existe na rota (RBAC), no DTO (allowlist de
   saída) e no banco (RLS + privilégios mínimos com role não-owner).
5. **Regra de negócio é dado, não código.** As 16 regras pendentes vivem em `business_rule`
   com versão e status; nenhuma é aplicada sem `approved` + aprovador + vigência.

## 3. Alternativas consideradas e rejeitadas

| Alternativa | Por que foi rejeitada |
| ----------- | --------------------- |
| **Next.js / Nuxt full-stack** | Traria roteamento, build e convenções de framework para uma base que hoje é HTML estático, aumentando a superfície sem resolver nenhum achado da auditoria. Reintroduziria o risco de lógica de autorização no cliente. |
| **Express 5** | Funcionaria, mas o ecossistema de plugins de segurança do Fastify (helmet, rate-limit, multipart com limites reais) é mais direto e o `inject()` do Fastify torna os testes E2E-HTTP viáveis sem subir porta. |
| **Prisma / TypeORM / Drizzle** | Um ORM esconderia exatamente o que precisa ficar explícito nesta entrega: RLS, `SET LOCAL ROLE`, `SECURITY DEFINER`, índices parciais, triggers append-only e `FOR UPDATE`. Optou-se por SQL parametrizado com uma camada fina de transação. Nenhuma query concatena entrada do usuário. |
| **Supabase / BaaS** | Traria provedor de identidade e RLS prontos, mas amarraria o programa a um fornecedor antes de o time definir provedor corporativo (D-02) e sem repositório atual para reconciliar. |
| **`openid-client` v6** | Boa biblioteca, porém a superfície de API mudou entre versões maiores; com `jose` o fluxo fica explícito, auditável e testável linha a linha. |
| **MongoDB / SQLite** | O modelo é relacional (ledger, histórico, RBAC, catálogo versionado) e o checklist pede RLS e constraints reais. |
| **Manter dois sistemas (board público + admin separado)** | Contraria a orientação de negócio e recria a divergência de fonte que gerou o achado ALTO-06. |

## 4. PGlite em desenvolvimento e teste

`@electric-sql/pglite` é o PostgreSQL 18 compilado para WebAssembly, executado no próprio
processo Node. Escolhido para que `npm test` e `npm run dev` funcionem sem instalar
servidor, sem Docker e sem rede.

**Verificado nesta entrega:** `CREATE ROLE`, `SET LOCAL ROLE`, políticas RLS realmente
aplicadas a uma role não-owner, `gen_random_uuid()` nativo, `jsonb` + índice GIN, triggers,
índices parciais únicos, `SECURITY DEFINER`, `FOR UPDATE` e views com `security_invoker`.

**Não disponível:** a extensão `pgcrypto`. Nenhum código depende dela — hashes usam
`node:crypto`.

**Limitação declarada:** a mesma migration precisa ser executada contra um PostgreSQL
servidor real antes da homologação. O driver `pg` já está implementado e é obrigatório em
staging/produção (`DB_DRIVER=pg`), mas essa execução não pôde ser feita neste ambiente.

## 5. Como o visual atual é preservado

`web/assets/styles.css` e `web/assets/map.css` vieram do protótipo **sem alteração de
identidade**; foram apenas anexados blocos novos para estados de UI (carregando, vazio,
erro, acesso negado, sessão expirada, prévia de importação) e foco visível. A única regra
que existia inline no HTML (`prefers-reduced-motion`) migrou para o CSS, porque a CSP
adotada não permite `unsafe-inline`.

O HTML manteve estrutura, classes, SVG do mapa e semântica. O que mudou: números fixos
viraram placeholders preenchidos pela API, o `localStorage` saiu, a autoria fabricada saiu,
e os nomes demonstrativos foram trocados por pessoas e empresas explicitamente fictícias.

## 6. Reconciliação futura com o repositório atual (D-01)

Se o repositório original aparecer, três caminhos ficam abertos, em ordem de preferência:

1. **Portar o backend como módulo.** `src/` não depende de Fastify fora de `src/http` e
   `src/modules`. Domínio, banco, importação e regras são funções puras sobre uma interface
   `Queryable` — migram para outro framework HTTP sem reescrita de regra.
2. **Manter este serviço e integrá-lo por identidade compartilhada.** O modelo já separa
   `staff_member` (pessoa) de `auth_identity` (identidade OIDC); apontar ambos os sistemas
   para o mesmo issuer resolve a identidade única sem fundir bancos.
3. **Importar o schema.** As migrations são SQL puro, sem dialeto de ORM, aplicáveis a
   qualquer PostgreSQL.

O que **não** deve ser feito: duplicar o catálogo, o ledger ou a trilha de auditoria em
dois sistemas. Se houver fusão, esta base deve ser a origem desses três.

## 7. Riscos e mitigação

| Risco | Mitigação adotada |
| ----- | ----------------- |
| Divergência entre PGlite e PostgreSQL servidor | Migrations em SQL padrão; driver `pg` implementado; execução contra servidor real listada como próximo passo obrigatório. |
| `tsx` como runtime de produção | Aceitável para MVP interno; um passo de build com esbuild é trabalho pequeno e está registrado como item futuro. Não bloqueia homologação funcional. |
| OIDC não verificável sem provedor | Fluxo implementado e isolado em `src/auth/oidc.ts`, com `503` explícito enquanto não configurado. Precisa de teste de fumaça contra o provedor real. |
| Regras aprovadas por engano | Constraint no banco impede `status='approved'` sem aprovador, data e vigência. |
| RLS quebrar consultas agregadas do board | Resolvido com funções `SECURITY DEFINER` de escopo fixo (migration 0010), revisáveis em code review, em vez de afrouxar policy ou consultar como owner. |
| Perda da identidade visual | CSS do protótipo preservado; mudanças isoladas em blocos anexados ao final dos arquivos. |

## 8. Consequências

- Um único processo, um único banco, um único modelo de permissão para operar e auditar.
- Qualquer funcionalidade dependente de regra pendente responde `422 PENDING_BUSINESS_RULE`
  com o identificador da decisão — o sistema explica por que não fez, em vez de inventar.
- Adicionar uma regra aprovada é uma operação de dados versionada, não um deploy de código.
