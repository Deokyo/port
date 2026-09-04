# Rules Pack — Programa WIN v0.1

> **Registro historico.** Este arquivo preserva a proposta inicial. As revisoes vigentes da
> candidata MVP-5 estao em `src/domain/rule-registry.ts`, na tabela `business_rule` e em
> `docs/DECISOES_PENDENTES_WIN.md`.

Este documento é o texto normativo das regras. O **status vigente** vive no banco, na
tabela `business_rule` (chave `rule_key` + `version`), e é lido em tempo de execução por
`src/domain/rules.ts`. O texto e o `definition` proposto são semeados a partir de
`src/domain/rule-registry.ts`.

## Regras de leitura

- **`proposed`** — existe recomendação técnica com alternativas e impacto. Não é aplicada.
- **`pending`** — não há recomendação possível sem definição de negócio. Não é aplicada.
- **`approved`** — só existe com **aprovador identificável, data de aprovação e vigência**.
  Uma constraint no banco (`business_rule_approval_requires_approver`) impede o contrário.
- **`retired`** — substituída por versão posterior; permanece para auditoria histórica.

Na candidata MVP-5, regras sustentadas pela politica assinada entram aprovadas; decisoes tomadas
fora dela so entram aprovadas quando `WIN_DECISION_APPROVER` identifica o responsavel. Sem essa
configuracao, essas decisoes permanecem `proposed`.

## Como aprovar uma regra

Aprovar é um ato de negócio registrado como dado, não um deploy:

```sql
update business_rule
   set status = 'approved',
       approver_name = 'Nome de quem aprovou',
       approver_role = 'Cargo/alçada',
       approved_at = now(),
       effective_from = now()
 where rule_key = 'RULE_...' and version = 1;
```

Se o `definition` proposto não for o escolhido, crie a **versão 2** com o conteúdo
aprovado em vez de editar a versão 1 — versões antigas explicam lançamentos antigos.

---

## RULE_POINTS_ACCRUAL — Cumulatividade dos pontos entre etapas

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_POINTS_ACCRUAL` v1 · decisão **D-03** |
| **Status** | `proposed` |
| **Declaração** | A pontuação é **não cumulativa**: ao avançar de etapa, lança-se a diferença entre a pontuação da nova etapa e o total já creditado para aquela indicação, de modo que o total por indicação seja sempre igual ao valor da etapa atingida. |
| **Atores** | Sistema (derivação); administrador e validador disparam a transição que a aciona. |
| **Entradas** | Etapa de destino, total já creditado para a indicação, tabela `points_rule` da versão vigente. |
| **Pré-condições** | Regra `approved` e vigente; etapa existente na tabela de pontos. |
| **Efeito** | Um lançamento em `points_ledger` com `origin='referral_stage'` ou `'import'`. |
| **Exceções** | Delta zero não gera lançamento (constraint `points_ledger_nonzero`). Etapa sem pontuação definida gera `422`. |
| **Repetição** | Idempotente por `idempotency_key` derivada de (origem, indicação, etapa). |
| **Concorrência** | A transição trava a indicação com `SELECT ... FOR UPDATE`; conflito de chave não duplica. |
| **Correção** | Nunca por `UPDATE`. Somente lançamento compensatório sob `RULE_POINTS_ADJUSTMENT`. |
| **Critério de aceite** | Uma indicação que percorre todo o funil termina com total igual ao valor de `sale_won`. Reprocessar a mesma etapa não altera o saldo. |
| **Alternativas** | **A)** cumulativa (soma cada etapa) — multiplica ~2,1x o total de uma indicação completa. **B)** somente a etapa final pontua — reduz o incentivo ao registro do funil. |
| **Fonte** | Briefing (pontos por etapa) + auditoria ALTO-02/ALTO-05. |
| **Aprovador / vigência** | — / — |

Proposta de tabela: `identified` 10 · `meeting_scheduled` 20 · `meeting_held` 30 ·
`proposal_sent` 50 · `sale_won` 100 · `lost` 0.

---

## RULE_POINTS_ADJUSTMENT — Concessão, estorno e correção de pontos

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_POINTS_ADJUSTMENT` v1 · decisão **D-17** |
| **Status** | `proposed` |
| **Declaração** | Correção e estorno acontecem exclusivamente por lançamento compensatório, com motivo obrigatório e autoria de sessão. `UPDATE` e `DELETE` no ledger são impossíveis. |
| **Atores** | `administrador` (permissão `points:adjust`). |
| **Entradas** | Matrícula, valor (positivo ou negativo, nunca zero), motivo com no mínimo 10 caracteres, lançamento de origem quando for correção. |
| **Pré-condições** | Sessão autenticada com a permissão; funcionário existente. |
| **Efeito** | Lançamento `kind='adjustment'` ou `'correction'` com `origin='manual'`. |
| **Exceções** | Correção sem motivo é recusada (`422` + constraint no banco). |
| **Repetição** | Chave de idempotência inclui instante; ajustes idênticos deliberados são possíveis, cada um auditado. |
| **Concorrência** | Insert-only; sem seção crítica. |
| **Correção** | Um lançamento de correção pode ser corrigido por outro, encadeado por `correction_of_entry_id`. |
| **Critério de aceite** | Após uma correção, o lançamento original continua legível e o saldo reflete a soma. |
| **Fonte** | Auditoria BD-04, AUS-05. |
| **Aprovador / vigência** | — / — |

---

## RULE_DUPLICATE_KEY — Chave e janela de duplicidade

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_DUPLICATE_KEY` v1 · decisão **D-04** |
| **Status** | `proposed` — **bloqueia a confirmação de importação** |
| **Declaração** | Duas indicações são duplicadas quando coincidem funcionário, serviço e empresa cliente normalizada dentro de uma janela de 90 dias corridos. |
| **Atores** | Sistema (detecção); administrador (decisão sobre casos sinalizados). |
| **Entradas** | `staff_id`, `service_id`, empresa cliente normalizada, data do fato. |
| **Pré-condições** | Regra `approved`; catálogo vigente. |
| **Efeito** | Preenche `referral.dedupe_fingerprint`, ativando o índice único parcial que já existe no banco. Linhas colidentes são marcadas `duplicate` e não aplicadas. |
| **Exceções** | Enquanto a regra não é aprovada, o fingerprint fica `NULL`, o índice permanece inerte e a confirmação de importação responde `422 PENDING_BUSINESS_RULE`. |
| **Repetição** | Determinística: mesma entrada, mesmo fingerprint. |
| **Concorrência** | Duas confirmações simultâneas: o índice único garante que apenas uma linha sobrevive. |
| **Correção** | Reclassificação registrada em `duplicate_check` com autoria e decisão (`duplicate` / `distinct`). |
| **Critério de aceite** | Reimportar o mesmo arquivo não cria indicação nova; duplicata dentro do próprio arquivo é marcada, não aplicada. |
| **Alternativas** | **A)** chave sem o funcionário — duas pessoas não podem indicar o mesmo cliente para o mesmo serviço; muda o incentivo do programa. **B)** janela por ciclo em vez de 90 dias corridos — alinha com o ranking, mas cria efeito de borda na virada. |
| **Fonte** | Auditoria ALTO-04, RP-06. |
| **Aprovador / vigência** | — / — |

---

## RULE_REFERRAL_STATE_MACHINE — Estados e transições oficiais

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_REFERRAL_STATE_MACHINE` v1 · decisão **D-06** |
| **Status** | `proposed` — **bloqueia toda transição de etapa** |
| **Declaração** | `identified → meeting_scheduled → meeting_held → proposal_sent → sale_won`. `lost` é alcançável de qualquer estado não terminal. Retrocesso é proibido. Terminais: `sale_won`, `lost`. |
| **Atores** | Conforme `RULE_TRANSITION_AUTHORITY`. |
| **Entradas** | Etapa atual, etapa de destino, data do fato. |
| **Pré-condições** | Regra `approved`; indicação ativa. |
| **Efeito** | Evento append-only em `referral_stage_event` e atualização de `referral.current_stage`. |
| **Exceções** | Transição fora do mapa responde `422` listando as permitidas. Sem a regra aprovada, qualquer transição responde `422 PENDING_BUSINESS_RULE`. |
| **Repetição** | Idempotente por (indicação, etapa, data): repetir devolve `replay: true` sem novo evento. |
| **Concorrência** | `SELECT ... FOR UPDATE` na indicação. |
| **Correção** | Novo evento com nota; o histórico anterior permanece. |
| **Critério de aceite** | Transição válida é aceita, inválida é recusada, repetida não duplica evento. |
| **Fonte** | Auditoria RP-05, MED-04. |
| **Aprovador / vigência** | — / — |

---

## RULE_TRANSITION_AUTHORITY — Ator autorizado em cada transição

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_TRANSITION_AUTHORITY` v1 · decisão **D-07** |
| **Status** | `proposed` |
| **Declaração** | Participante registra apenas `identified`. De `meeting_scheduled` em diante, somente `validador_comercial` ou `administrador`. `sale_won` exige `validador_comercial`. |
| **Atores** | Todos os papéis. |
| **Entradas** | Etapa de destino, papéis da sessão. |
| **Pré-condições** | Máquina de estados aprovada. |
| **Efeito** | Permite ou recusa a transição com `403`. |
| **Exceções** | Se esta regra não estiver aprovada mas a máquina estiver, a transição é permitida a quem tem `referral:transition` — a alçada fina fica inativa e isso deve ser conhecido antes de aprovar D-06 isoladamente. |
| **Repetição** | Sem efeito colateral. |
| **Concorrência** | N/A. |
| **Correção** | Alteração de alçada é nova versão da regra. |
| **Critério de aceite** | Administrador não consegue marcar `sale_won` se a regra reservar isso ao validador. |
| **Fonte** | Auditoria RP-04, AP-07. |
| **Aprovador / vigência** | — / — |

---

## RULE_REFERRAL_VALIDITY — Critério de indicação válida

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_REFERRAL_VALIDITY` v1 · decisão **D-18** |
| **Status** | `pending` — sem recomendação técnica possível |
| **Declaração** | Não informada. Perguntas em aberto: cliente já ativo conta? Prospect sem contato conta? Indicação de outra unidade conta? |
| **Atores** | Validador comercial. |
| **Efeito quando existir** | Filtra o que entra em ranking, pontuação e território. |
| **Situação atual** | Toda indicação registrada é considerada existente; nenhuma é qualificada como "válida" pelo sistema, porque não há critério. |
| **Critério de aceite** | A definir com a área comercial. |
| **Fonte** | Checklist RP-08. |
| **Aprovador / vigência** | — / — |

---

## RULE_TERRITORY_THRESHOLD — Threshold de conquista de território

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_TERRITORY_THRESHOLD` v1 · decisão **D-05** |
| **Status** | `proposed` |
| **Declaração** | Um serviço é conquistado com ao menos uma indicação em `sale_won`. O território é conquistado quando 100% dos seus serviços estão conquistados. |
| **Atores** | Sistema. |
| **Entradas** | Indicações em `sale_won` por serviço, catálogo vigente. |
| **Pré-condições** | Regra `approved`. |
| **Efeito** | `territory_progress.state` muda para `in_progress` ou `conquered`. |
| **Exceções** | Sem a regra aprovada, o estado permanece `locked` e o board exibe apenas o **fato** (serviços com venda), sem afirmar conquista. |
| **Repetição** | Recalculável; idempotente. |
| **Concorrência** | Projeção de leitura; sem seção crítica. |
| **Correção** | Recalcular após correção de indicação. |
| **Critério de aceite** | Território com todos os serviços vendidos aparece como conquistado; um a menos, não. |
| **Alternativas** | **A)** percentual configurável (ex.: 60%). **B)** por pontos acumulados no território. |
| **Fonte** | Checklist RP-07. |
| **Aprovador / vigência** | — / — |

---

## RULE_TERRITORY_RETENTION — Manutenção, perda ou expiração de território

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_TERRITORY_RETENTION` v1 · decisão **D-19** |
| **Status** | `pending` |
| **Declaração** | Não informado se a conquista é permanente, válida por ciclo ou expirável. |
| **Efeito quando existir** | Define se `conquered` regride e em que condição. |
| **Situação atual** | Nenhuma rotina de expiração existe. Nada regride sozinho. |
| **Fonte** | Auditoria AUS (retenção de conquista). |
| **Aprovador / vigência** | — / — |

---

## RULE_RANKING_CYCLE — Periodicidade oficial e desempate

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_RANKING_CYCLE` v1 · decisão **D-08** |
| **Status** | `proposed` |
| **Declaração** | Ciclo oficial **mensal**; semanal e trimestral seguem como visões. Desempate: 1) mais indicações em `sale_won`; 2) menor tempo médio até `sale_won`; 3) ordem do código do funcionário. |
| **Atores** | Sistema. |
| **Entradas** | Janela do ciclo no fuso de negócio, ledger, indicações. |
| **Pré-condições** | Regra `approved` para que o ranking seja considerado oficial. |
| **Efeito** | Ordenação do leaderboard e base do `ranking_snapshot` no fechamento. |
| **Exceções** | Sem aprovação, o board exibe a ordenação técnica atual e declara que a periodicidade oficial está pendente. |
| **Repetição** | Determinística — o terceiro critério de desempate garante ordem estável. |
| **Concorrência** | Leitura. |
| **Correção** | Ciclo já fechado não é reescrito (ver `RULE_CYCLE_CLOSING`). |
| **Critério de aceite** | Dois participantes empatados em pontos aparecem sempre na mesma ordem entre execuções. |
| **Fonte** | Checklist RP-10. |
| **Aprovador / vigência** | — / — |

---

## RULE_CROSS_SELL — Identificação de cross-sell

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_CROSS_SELL` v1 · decisão **D-20** |
| **Status** | `pending` |
| **Declaração** | Intenção registrada no briefing, sem regra operacional. |
| **Situação atual** | A tabela `cross_sell_opportunity` existe e permanece vazia. Nenhuma oportunidade é inferida. |
| **Fonte** | Checklist RP-09. |
| **Aprovador / vigência** | — / — |

---

## RULE_FINANCIAL_BONUS — Bonificação financeira

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_FINANCIAL_BONUS` v1 · decisão **D-09** |
| **Status** | `pending` |
| **Declaração** | Escopo não confirmado. A ausência no protótipo **não** é decisão de escopo. |
| **Situação atual** | O sistema não calcula, não exibe e não persiste valor de bonificação. |
| **Critério de aceite** | A definir. Envolve dado financeiro e provavelmente exige controle de acesso próprio. |
| **Fonte** | Checklist RP-11. |
| **Aprovador / vigência** | — / — |

---

## RULE_RETENTION_INACTIVATION — Inativação e retenção de registros

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_RETENTION_INACTIVATION` v1 · decisão **D-11** |
| **Status** | `pending` — depende de parecer de privacidade |
| **Declaração** | Prazo de retenção e destino de dados de funcionário desligado não definidos. |
| **Situação atual** | O schema suporta inativação lógica (`staff_member.status` + motivo obrigatório). Nenhuma rotina de expurgo está ativa. Nada é apagado automaticamente. |
| **Critério de aceite** | Um desligamento deve preservar a autoria histórica e a integridade do ledger, qualquer que seja a política. |
| **Fonte** | Checklist RP-12, IS-10. |
| **Aprovador / vigência** | — / — |

---

## RULE_CYCLE_CLOSING — Fechamento e alteração retroativa de ciclos

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_CYCLE_CLOSING` v1 · decisão **D-14** |
| **Status** | `proposed` |
| **Declaração** | Ao fechar um ciclo, grava-se `ranking_snapshot` imutável. Fatos com data dentro de um ciclo fechado são aceitos, mas afetam apenas o ciclo corrente — nunca o snapshot publicado. |
| **Atores** | Administrador. |
| **Entradas** | Ciclo, ledger e indicações da janela. |
| **Pré-condições** | Regra `approved`; ciclo `open`. |
| **Efeito** | `ranking_cycle.status='closed'` + snapshot append-only. |
| **Exceções** | Importação retroativa não reabre ciclo fechado. |
| **Repetição** | Fechar duas vezes é conflito, não duplicação. |
| **Concorrência** | Fechamento sob trava do ciclo. |
| **Correção** | Correção posterior aparece no ciclo corrente, com rastro. |
| **Critério de aceite** | Um snapshot publicado nunca muda de valor. |
| **Fonte** | Auditoria AUS (fechamento de ciclo). |
| **Aprovador / vigência** | — / — |

---

## RULE_CLIENT_COMPANY_VISIBILITY — Exibição da empresa cliente

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_CLIENT_COMPANY_VISIBILITY` v1 · decisão **D-12** |
| **Status** | `proposed` — o padrão seguro **já está aplicado** |
| **Declaração** | Empresa cliente nunca aparece em ranking, mapa ou perfil de terceiros. Visível apenas ao próprio indicador, ao validador e ao administrador. |
| **Atores** | Todos. |
| **Efeito** | Allowlist de saída: `client_company` está na lista de chaves proibidas dos DTOs públicos. |
| **Exceções** | Nenhuma. Ampliar visibilidade exige aprovação explícita e nova versão. |
| **Critério de aceite** | Nenhuma resposta de `/api/v1/board/*` contém empresa cliente — verificado por teste automatizado. |
| **Observação** | Este é o único caso em que a proposta já é o comportamento vigente, porque o padrão seguro é não expor. Aprovar serve para autorizar eventual exceção, não para ligar a proteção. |
| **Fonte** | Auditoria AUS (dado de terceiro). |
| **Aprovador / vigência** | — / — |

---

## RULE_ANTIFRAUD — Antifraude do programa

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_ANTIFRAUD` v1 · decisão **D-15** |
| **Status** | `pending` |
| **Declaração** | Sem regra para autoindicação, conluio entre participantes ou indicação de cliente já ativo. |
| **Situação atual** | Nenhuma detecção ativa. A trilha de auditoria registra autoria e horário de tudo, o que permite investigação posterior. |
| **Fonte** | Auditoria AUS (antifraude). |
| **Aprovador / vigência** | — / — |

---

## RULE_POINTS_DISPUTE — Contestação de pontuação

| Campo | Conteúdo |
| --- | --- |
| **ID / versão** | `RULE_POINTS_DISPUTE` v1 · decisão **D-21** |
| **Status** | `pending` |
| **Declaração** | Não há processo definido: quem abre, prazo, quem julga, efeito no ranking durante a análise. |
| **Situação atual** | O ledger append-only e a auditoria fornecem a evidência necessária para instruir uma contestação quando o processo existir. |
| **Fonte** | Auditoria AUS (contestação). |
| **Aprovador / vigência** | — / — |
