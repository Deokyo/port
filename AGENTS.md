# AGENTS.md — regras para agentes (Claude, Codex e outros)

> Regras de trabalho para agentes neste repositório (Claude, Codex e outros). Mantidas pelo dono do portfólio.

## Antes de qualquer alteração

1. Leia o `README.md` do repositório e este arquivo.
2. Rode `git status` e `git fetch`. Não apague nem sobrescreva alterações locais que não são suas.
3. Entenda o que já existe antes de modificar. Preserve padrões e convenções.

## Autorização (regra principal)

Sem autorização explícita do dono, **não** faça: push, abrir PR, merge, tag, deploy, apagar branch, mudar configuração do repositório.
Aprovar o código não autoriza publicar. Cada etapa é pedida separadamente.
Só diga que algo foi atualizado depois de conferir no GitHub. Sem conferir, diga "preparado".

## Branches, commits e PRs

- Nunca trabalhe direto na `main`. Branch com prefixo da ferramenta: `claude/<assunto>`, `codex/<assunto>`.
- **Um PR mexe em um case por vez**, para um cliente não ser misturado com outro.
- Commit: título em inglês, curto, no imperativo (ex.: "Keep analytics off standalone demos"). Um assunto por commit.
- Commits de agente levam no fim da mensagem os trailers `Co-Authored-By` e a sessão de origem.
- PR: descrição com o que mudou, como foi testado, riscos. Comece em rascunho.
- Merge: squash, só com autorização. Nunca `force push`, nunca `amend` em commit já enviado.
- A `main` do `Deokyo/port` publica o site (GitHub Pages): merge nela é publicação.

## Segurança e isolamento

- Nenhum segredo, token ou credencial no código, no Git ou em logs. Variáveis só em `.env.example`, sem valores.
- Nada de um cliente entra em outro: identificadores, tracking, formulários, CRM, textos, imagens.
- O `/port/` é só vitrine: entram páginas **sanitizadas** (demos) e o case. Páginas reais, domínio e hospedagem são assunto do cliente e não passam pelo `port`.
- **Tracking (GTM, Umami) é só do site do portfólio.** Fica nas páginas do portfólio e nunca nas demos independentes (`cases/*/demo/`) nem em materiais de cliente.
- Dados reais de clientes não entram em demos, testes nem no portfólio. Respeite o `NOTICE.md`.

## Conteúdo

- Não invente números, resultados, depoimentos, certificações, preços ou prazos.
- Separe o que é fato confirmado, hipótese e lacuna.

## Verificação

- Rode as verificações do projeto antes de abrir PR (no `port`: `node scripts/check-site.mjs`).
- Informe o que foi testado e o que não foi.

## Limites conhecidos do ambiente do Claude

- `gh pr create` não funciona (GraphQL bloqueado): abra PR pela API REST.
- Excluir branch remoto é instável. Confirme no GitHub depois de tentar.
