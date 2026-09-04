-- 0015 Alinha o schema ativo ao piloto por planilha e fecha integridade de competencia/estorno.

-- A coluna nasceu com o nome do CRM previsto na politica. No piloto, o rastro e o registro
-- auditavel no proprio Programa WIN; o nome do campo deve refletir o fato armazenado.
alter table qualified_meeting
  rename column ploomes_registered to program_registered;

comment on column qualified_meeting.program_registered is
  'Registro auditavel no Programa WIN. Sempre verdadeiro para reunioes criadas pela API do piloto.';

-- Identificador de CRM legado: preservado apenas para compatibilidade de dados anteriores.
drop index if exists referral_ploomes_uq;
comment on column referral.ploomes_id is
  'Campo legado de integracao futura. Nao utilizado por telas, importacao ou regras ativas do piloto.';

-- Versoes da politica que pressupunham um identificador externo ficam apenas como historico.
-- As revisoes do piloto sao semeadas depois e so entram aprovadas com responsavel identificavel.
update business_rule set status = 'retired'
 where (rule_key, version) in (
   ('RULE_OPPORTUNITY_TYPES', 1),
   ('RULE_QUALIFIED_MEETING', 1),
   ('RULE_REFERRAL_VALIDITY', 2),
   ('RULE_CLIENT_COMPANY_VISIBILITY', 2),
   ('RULE_OPERATING_MODEL', 1)
 );

-- Um recebimento pode sofrer estornos parciais. A soma e serializada e validada no dominio.
drop index if exists revenue_event_reversal_uq;
create index revenue_event_reversal_idx on revenue_event (reverses_event_id)
  where reverses_event_id is not null;

-- NOT VALID evita quebrar uma base atual que tenha estorno historico anterior ao vinculo
-- introduzido na 0014. A constraint ja vale para todo evento novo; a validacao do legado deve
-- acontecer depois de reconciliar cada estorno antigo com seu recebimento, sem inventar vinculo.
alter table revenue_event add constraint revenue_event_reversal_shape check (
  (kind = 'receipt' and reverses_event_id is null)
  or (kind = 'reversal' and reverses_event_id is not null)
) not valid;

-- A janela usada para montar o lote precisa permanecer auditavel no proprio lote.
alter table payout_batch
  add column competence_from date,
  add column competence_to date;

alter table payout_batch add constraint payout_batch_competence_shape check (
  (competence_from is null and competence_to is null)
  or (competence_from is not null and competence_to is not null and competence_from <= competence_to)
);

-- A rota de titularidade e da Diretoria, mas as policies anteriores so permitiam que admin e
-- Comercial lessem staff/referral, e somente admin lia a linha de importacao. O HTTP autorizava
-- o ato e o banco o tornava impossivel. Estas policies liberam apenas o minimo para a decisao.
create policy staff_director_read on staff_member for select
  using (app_is_director());

create policy referral_director_read on referral for select
  using (app_is_director());

create policy referral_director_update on referral for update
  using (app_is_director()) with check (app_is_director());

-- A verificacao que impede trocar o titular de uma indicacao ja pontuada precisa enxergar o
-- ledger; sem esta leitura, a RLS transformaria a contagem em zero e liberaria uma transferencia.
create policy points_ledger_director_read on points_ledger for select
  using (app_is_director());

alter table duplicate_check enable row level security;
create policy duplicate_check_admin on duplicate_check for all
  using (app_is_admin()) with check (app_is_admin());
create policy duplicate_check_director_read on duplicate_check for select
  using (app_is_director());
create policy duplicate_check_director_update on duplicate_check for update
  using (app_is_director()) with check (app_is_director());

create policy import_row_director_conflict_read on import_row for select
  using (
    app_is_director()
    and exists (select 1 from duplicate_check d where d.import_row_id = import_row.id)
  );
create policy import_row_director_conflict_update on import_row for update
  using (
    app_is_director()
    and exists (select 1 from duplicate_check d where d.import_row_id = import_row.id)
  )
  with check (
    app_is_director()
    and exists (select 1 from duplicate_check d where d.import_row_id = import_row.id)
  );

-- A role Diretoria ja possuia audit:read na API; a policy precisa refletir a mesma matriz.
create policy audit_read_director on audit_event for select
  using (app_is_director());
