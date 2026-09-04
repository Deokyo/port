# Decisoes do Programa WIN

Este documento separa o que ja possui fonte aprovada do que ainda precisa de decisao. O status
executavel vive em `business_rule`; nenhuma decisao tomada fora da politica entra como aprovada
sem `WIN_DECISION_APPROVER` identificar a pessoa responsavel.

## Confirmadas

| ID | Decisao vigente | Fonte |
| --- | --- | --- |
| D-03 | Pontuacao cumulativa por etapa: 10, 20, 30, 50 e 100; etapa pulada nao pontua retroativamente | decisao registrada em 03/09/2026 |
| D-04 | Titularidade por empresa cliente normalizada + servico; primeiro registro vence; colisao entre pessoas vai para decisao humana | decisao registrada em 03/09/2026 |
| D-06 | Sequencia do funil com salto para frente permitido e retrocesso proibido | decisao registrada em 03/09/2026 |
| D-09 | Premiacao em dinheiro pelo Anexo I, calculada sobre receita recebida | LOCTL CORP COML 001 rev. 03 |
| D-12 | Empresa cliente permanece no backend; API e exportacao usam apenas referencia interna opcional | decisao registrada em 03/09/2026 |
| D-20 | Tipos: novo cliente, novo servico, cross-sell e up-sell | LOCTL CORP COML 001 rev. 03 |
| D-27 | Entrada por planilha, previa e conferencia manual atestada | decisao registrada em 03/09/2026 |
| D-28 | O proprio Programa WIN e a fonte operacional do piloto | decisao registrada em 03/09/2026 |

No launcher local, essas decisoes recebem um aprovador **sintetico de teste** para permitir a
avaliacao do produto. Homologacao e producao exigem o nome do responsavel real na configuracao.

## Pendentes

### D-02 - Provedor de identidade

Definir provedor OIDC corporativo, client, redirect autorizado, mapeamento de identidade e MFA.
Sem isso, existe apenas a sessao local de teste; nenhum login real deve ser homologado.

### D-05 e D-19 - Conquista e manutencao de territorio

Definir o criterio mensuravel de conquista e se ela e permanente, por ciclo ou expiravel. Ate a
decisao, o mapa mostra servicos e vendas como fatos, mas nao declara territorio conquistado.

### D-07 - Alcada por etapa

A politica define quem valida elegibilidade e quem aprova pagamento, mas nao define quem move
cada etapa do funil. A API continua protegida por `referral:transition`; a matriz fina depende de
aprovacao propria.

### D-08 e D-14 - Ranking e fechamento

Definir periodicidade oficial, criterios de desempate e efeito de fatos retroativos depois do
fechamento. Ranking oficial e snapshots permanecem desligados.

### D-11 - Retencao e expurgo

Definir prazos e tratamento de nome, empresa cliente, staging de importacao, auditoria e ledgers
com o responsavel por privacidade. Nao existe rotina automatica de expurgo.

### D-15 - Antifraude

Definir regras para autoindicacao, cliente ja ativo, conluio e concentracao anomala. O MVP mantem
rastreabilidade, mas nao classifica fraude automaticamente.

### D-17 - Ajuste manual de pontos

Definir alcada e cenarios permitidos. Enquanto `RULE_POINTS_ADJUSTMENT` nao estiver aprovada, a
rota de ajuste responde `422 PENDING_BUSINESS_RULE`.

### D-21 - Contestacao

Definir quem abre, prazo, quem decide e se o ranking congela durante a analise.

### D-29 - Premiacao compartilhada

Definir percentuais de rateio, arredondamento, vigencia e tratamento de lancamentos anteriores.
O desfecho `shared_award` e recusado enquanto `RULE_SHARED_AWARD_SPLIT` estiver pendente. A
decisao `single_owner` funciona quando a indicacao ainda nao possui lancamentos; transferir uma
indicacao ja pontuada ou premiada exige regra propria para os ajustes compensatorios.

## Dependencias externas

- referencia definitiva do repositorio e ambiente de homologacao;
- PostgreSQL gerenciado, backup e restore testados;
- monitoramento, alertas, TLS e gestao de segredos;
- autorizacao explicita para qualquer publicacao.

Esses itens nao impedem a avaliacao local, mas impedem uma decisao de producao.
