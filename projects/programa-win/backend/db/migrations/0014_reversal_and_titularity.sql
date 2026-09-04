-- 0014 Duas correcoes encontradas em revisao:
--
-- (a) Estorno sem limite. A secao 8 da politica manda ajustar em apuracao posterior quando ha
--     cancelamento, estorno, devolucao ou inadimplencia. Nada disso autoriza devolver MAIS do
--     que entrou. Sem vinculo com o recebimento revertido e sem teto acumulado, variar a data ou
--     a referencia gerava chaves de idempotencia diferentes e permitia empilhar negativos.
--
-- (b) Conflito de titularidade sem desfecho real. A regra preve dono unico OU premiacao
--     compartilhada; a tabela so aceitava 'duplicate'/'distinct', e a justificativa recebida
--     pela API era descartada. Decisao de governanca sem justificativa gravada nao e auditavel.

alter table revenue_event
  add column reverses_event_id uuid references revenue_event (id) on delete restrict;

comment on column revenue_event.reverses_event_id is
  'Recebimento que este estorno reverte. Obrigatorio por regra de dominio para kind=reversal.';

-- Um recebimento nao pode ser revertido duas vezes pelo mesmo caminho.
create unique index revenue_event_reversal_uq on revenue_event (reverses_event_id)
  where reverses_event_id is not null;

alter table duplicate_check drop constraint duplicate_check_decision_check;
alter table duplicate_check add constraint duplicate_check_decision_check
  check (decision in ('pending', 'single_owner', 'shared_award', 'distinct'));

alter table duplicate_check
  add column justification text,
  add column resolved_owner_staff_id uuid references staff_member (id) on delete restrict,
  add column shared_with_staff_id uuid references staff_member (id) on delete restrict;

-- Secao 6: a decisao e da Diretoria com o Comercial e precisa de evidencia registrada.
alter table duplicate_check add constraint duplicate_check_resolution_requires_justification
  check (
    decision = 'pending'
    or (justification is not null and decided_by is not null and decided_at is not null)
  );

-- Dono unico exige dizer QUEM. Compartilhada exige dizer com quem.
alter table duplicate_check add constraint duplicate_check_outcome_shape
  check (
    (decision <> 'single_owner' or resolved_owner_staff_id is not null)
    and (decision <> 'shared_award' or shared_with_staff_id is not null)
  );
