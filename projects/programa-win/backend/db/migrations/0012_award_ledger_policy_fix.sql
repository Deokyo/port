-- 0012 correcao de politica de RLS no ledger de premiacao.
--
-- Motivo: a Politica LOCTL CORP COML 001 rev. 03 (secoes 5 e 6) atribui a Area Comercial o
-- registro da receita liquida recebida — e a apuracao da premiacao e consequencia direta desse
-- registro. A policy original exigia app_is_admin() para inserir em award_ledger, o que impedia
-- o Comercial de executar exatamente o que a politica lhe atribui.
--
-- O valor NAO fica a criterio de quem registra: ele e derivado no servidor a partir da tabela
-- do Anexo I na versao aprovada e vigente. Continua valendo o portao do pagamento: o desembolso
-- so ocorre com aprovacao da Diretoria (secao 8), via payout_batch.
--
-- Migrations sao imutaveis: por isso a correcao vem em arquivo novo, nao editando a 0011.

drop policy award_ledger_insert on award_ledger;

create policy award_ledger_insert on award_ledger for insert
  with check (app_is_admin() or app_is_validator());

comment on table award_ledger is
  'Ledger monetario da premiacao (Politica LOCTL CORP COML 001 rev. 03). Append-only. '
  'Inserido por Comercial ou administrador; o valor vem sempre da tabela do Anexo I aprovada. '
  'Pagamento depende de aprovacao da Diretoria (secao 8).';

-- A Area Comercial precisa enxergar os lancamentos que a propria validacao gera (a premiacao de
-- R$ 50,00 da reuniao qualificada nasce no mesmo ato). Continua sem alcance sobre pagamento.
drop policy award_ledger_read on award_ledger;
create policy award_ledger_read on award_ledger for select
  using (app_is_admin() or app_is_director() or app_is_validator()
         or staff_id = app_current_staff());

-- O registro da receita liquida recebida permanece um ato financeiro/administrativo: a policy
-- de insert em revenue_event NAO e afrouxada. Por coerencia, a permissao 'revenue:record'
-- tambem deixa de ser atribuida ao papel validador_comercial (ver src/db/seed-catalog.ts).
