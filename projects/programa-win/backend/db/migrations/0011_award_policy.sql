-- 0011 premiacao financeira conforme a Politica LOCTL CORP COML 001, revisao 03.
-- Fonte: "Politica corporativa de incentivo a geracao de novos negocios", emissao 01/09/2026,
-- assinada por People & Culture, Juridico e Comercial (validacao XL5YF-J9X56-D4DS3-3NGSD).
--
-- Esta migration existe porque a politica assinada define a premiacao em DINHEIRO
-- (R$ fixo e percentual sobre receita liquida), nao em pontos. O modelo de pontos do
-- prototipo continua no schema, mas nao tem respaldo na politica — ver DECISOES_PENDENTES.
--
-- Valores monetarios usam numeric(14,2) e taxas usam numeric(7,4). Nenhum calculo de
-- dinheiro passa por ponto flutuante: a multiplicacao acontece no proprio PostgreSQL.

-- Secao 2 da politica.
create type opportunity_type as enum ('new_client', 'new_service', 'cross_sell', 'up_sell');

-- Secao 3 e Anexo I.
create type award_situation as enum (
  'qualified_meeting',            -- reuniao qualificada realizada: R$ 50,00
  'new_service_cross_up_sell',    -- novo servico / cross-sell / up-sell
  'new_client_referral',          -- novo cliente por indicacao/networking
  'new_client_by_manager'         -- novo cliente originado diretamente pelo gestor
);

create type award_beneficiary as enum ('collaborator', 'manager');

-- Secao 5: projetos com faturamento unico x contratos recorrentes.
create type contract_billing as enum ('one_off', 'recurring');

-- Secao 8: recebimento gera premiacao; cancelamento/estorno gera ajuste posterior.
create type revenue_kind as enum ('receipt', 'reversal');

/* -------------------------------------------------------------------------- */
/* Campos que a politica exige na oportunidade (secoes 2, 5, 6 e 8).           */
/* -------------------------------------------------------------------------- */
alter table referral
  add column opportunity_type        opportunity_type,
  add column ploomes_id              text,      -- secao 6: registro previo no CRM
  add column manager_staff_id        uuid references staff_member (id) on delete restrict,
  add column contract_billing        contract_billing,
  add column contract_signed_at      timestamptz,
  add column service_started_at      timestamptz,
  add column eligibility_status      text not null default 'pending_validation'
    check (eligibility_status in ('pending_validation', 'eligible', 'ineligible')),
  add column ineligibility_reason    text,
  add column validated_by            uuid references auth_identity (id) on delete restrict,
  add column validated_at            timestamptz,
  add column titularity_note         text;      -- secao 6: conflito de titularidade

-- Secao 6: a oportunidade so e elegivel com registro previo no Ploomes.
create unique index referral_ploomes_uq on referral (ploomes_id)
  where ploomes_id is not null and status = 'active';

-- Secao 6: elegivel exige validacao identificada da Area Comercial.
alter table referral add constraint referral_eligibility_requires_validation check (
  eligibility_status <> 'eligible'
  or (validated_by is not null and validated_at is not null and ploomes_id is not null)
);
alter table referral add constraint referral_ineligible_requires_reason check (
  eligibility_status <> 'ineligible' or ineligibility_reason is not null
);
create index referral_eligibility_idx on referral (eligibility_status);
create index referral_manager_idx on referral (manager_staff_id);

/* -------------------------------------------------------------------------- */
/* Anexo I — tabela de premiacao, versionada e presa a uma regra de negocio.   */
/* -------------------------------------------------------------------------- */
create table award_rule (
  id            uuid primary key default gen_random_uuid(),
  rule_key      text not null,
  rule_version  int  not null,
  situation     award_situation not null,
  beneficiary   award_beneficiary not null,
  kind          text not null check (kind in ('fixed', 'percentage')),
  fixed_amount  numeric(14,2) check (fixed_amount is null or fixed_amount > 0),
  rate          numeric(7,4)  check (rate is null or (rate > 0 and rate < 1)),
  constraint award_rule_rule_fk foreign key (rule_key, rule_version)
    references business_rule (rule_key, version) on delete restrict,
  constraint award_rule_unique unique (rule_key, rule_version, situation, beneficiary),
  constraint award_rule_shape check (
    (kind = 'fixed'      and fixed_amount is not null and rate is null) or
    (kind = 'percentage' and rate is not null and fixed_amount is null)
  )
);

/* -------------------------------------------------------------------------- */
/* Secao 4 — reuniao qualificada. Os cinco requisitos ficam registrados um a   */
/* um: a premiacao de R$ 50,00 so nasce quando todos forem atendidos.          */
/* -------------------------------------------------------------------------- */
create table qualified_meeting (
  id                  uuid primary key default gen_random_uuid(),
  referral_id         uuid not null references referral (id) on delete restrict,
  held_at             timestamptz not null,
  icp_fit             boolean not null,   -- empresa aderente ao perfil de cliente
  decision_maker      boolean not null,   -- decisor ou influenciador relevante
  potential_identified boolean not null,  -- potencial para contratacao
  ploomes_registered  boolean not null,   -- oportunidade registrada no Ploomes
  commercial_validated boolean not null,  -- validacao pela Area Comercial
  validated_by        uuid references auth_identity (id) on delete restrict,
  validator_label     text not null,
  recorded_at         timestamptz not null default now(),
  idempotency_key     text not null unique,
  note                text,
  constraint qualified_meeting_one_per_referral unique (referral_id)
);
create index qualified_meeting_referral_idx on qualified_meeting (referral_id);
create trigger qualified_meeting_append_only
  before update or delete on qualified_meeting
  for each row execute function enforce_append_only();

/* -------------------------------------------------------------------------- */
/* Secao 5 — receita liquida efetivamente recebida. Cada recebimento e um      */
/* fato imutavel; cancelamento/estorno entra como evento negativo.             */
/* -------------------------------------------------------------------------- */
create table revenue_event (
  id                uuid primary key default gen_random_uuid(),
  referral_id       uuid not null references referral (id) on delete restrict,
  kind              revenue_kind not null,
  net_amount        numeric(14,2) not null check (net_amount > 0),
  competence_date   date not null,        -- competencia do recebimento
  received_at       timestamptz not null, -- momento efetivo (secao 8)
  recorded_at       timestamptz not null default now(),
  actor_identity_id uuid references auth_identity (id) on delete restrict,
  actor_label       text not null,
  source_reference  text,                 -- NF, titulo ou lancamento de origem
  idempotency_key   text not null unique,
  note              text
);
create index revenue_event_referral_idx on revenue_event (referral_id, received_at);
create trigger revenue_event_append_only
  before update or delete on revenue_event
  for each row execute function enforce_append_only();

/* -------------------------------------------------------------------------- */
/* Ledger monetario append-only. Correcao so por lancamento compensatorio.     */
/* -------------------------------------------------------------------------- */
create table award_ledger (
  id                uuid primary key default gen_random_uuid(),
  referral_id       uuid not null references referral (id) on delete restrict,
  staff_id          uuid not null references staff_member (id) on delete restrict,
  beneficiary       award_beneficiary not null,
  situation         award_situation not null,
  amount            numeric(14,2) not null check (amount <> 0),
  base_amount       numeric(14,2),   -- receita liquida que originou o percentual
  rate_applied      numeric(7,4),
  kind              text not null check (kind in ('grant', 'reversal', 'adjustment', 'correction')),
  revenue_event_id  uuid references revenue_event (id) on delete restrict,
  rule_key          text not null,
  rule_version      int  not null,
  effective_at      timestamptz not null,
  recorded_at       timestamptz not null default now(),
  actor_identity_id uuid references auth_identity (id) on delete restrict,
  actor_label       text not null,
  correction_of_entry_id uuid references award_ledger (id) on delete restrict,
  reason            text,
  idempotency_key   text not null unique,
  constraint award_ledger_rule_fk foreign key (rule_key, rule_version)
    references business_rule (rule_key, version) on delete restrict,
  constraint award_ledger_correction_requires_reason
    check (correction_of_entry_id is null or reason is not null),
  constraint award_ledger_percentage_shape check (
    (rate_applied is null and base_amount is null) or
    (rate_applied is not null and base_amount is not null)
  )
);
create index award_ledger_staff_idx    on award_ledger (staff_id, effective_at);
create index award_ledger_referral_idx on award_ledger (referral_id);
create trigger award_ledger_append_only
  before update or delete on award_ledger
  for each row execute function enforce_append_only();

create or replace view award_balance as
  select staff_id,
         sum(amount)::numeric(14,2) as balance,
         count(*)::int as entries,
         max(effective_at) as last_entry_at
    from award_ledger group by staff_id;

/* -------------------------------------------------------------------------- */
/* Secao 8 — pagamento na folha subsequente a validacao do Comercial e         */
/* aprovacao da Diretoria. O lote e o gate: nada e pago sem aprovacao.         */
/* -------------------------------------------------------------------------- */
create table payout_batch (
  id                uuid primary key default gen_random_uuid(),
  label             text not null unique,
  payroll_reference text not null,          -- folha de referencia (AAAA-MM)
  status            text not null default 'open'
                      check (status in ('open', 'approved', 'paid', 'cancelled')),
  created_by        uuid references auth_identity (id) on delete restrict,
  created_by_label  text not null,
  approved_by       uuid references auth_identity (id) on delete restrict,
  approver_label    text,
  approved_at       timestamptz,
  paid_at           timestamptz,
  created_at        timestamptz not null default now(),
  constraint payout_batch_approval_requires_approver check (
    status not in ('approved', 'paid') or (approved_by is not null and approved_at is not null)
  )
);

-- Vinculo append-only entre lote e lancamento: o ledger nunca e alterado.
create table payout_item (
  id              uuid primary key default gen_random_uuid(),
  batch_id        uuid not null references payout_batch (id) on delete restrict,
  award_entry_id  uuid not null references award_ledger (id) on delete restrict,
  added_at        timestamptz not null default now(),
  constraint payout_item_unique unique (award_entry_id)
);
create index payout_item_batch_idx on payout_item (batch_id);
create trigger payout_item_append_only
  before update or delete on payout_item
  for each row execute function enforce_append_only();

/* -------------------------------------------------------------------------- */
/* Privilegios e RLS                                                           */
/* -------------------------------------------------------------------------- */
create or replace function app_is_director() returns boolean
  language sql stable as $$
  select coalesce(nullif(current_setting('app.is_director', true), ''), 'off') = 'on' $$;

grant select on award_rule, award_balance to win_app;
grant select, insert, update, delete on payout_batch to win_app;
grant select, insert on qualified_meeting, revenue_event, award_ledger, payout_item to win_app;

alter table qualified_meeting enable row level security;
alter table revenue_event     enable row level security;
alter table award_ledger      enable row level security;
alter table payout_batch      enable row level security;
alter table payout_item       enable row level security;

alter view award_balance set (security_invoker = true);

create policy qualified_meeting_read on qualified_meeting for select
  using (app_is_admin() or app_is_validator() or app_is_director()
         or exists (select 1 from referral r
                     where r.id = qualified_meeting.referral_id
                       and r.staff_id = app_current_staff()));
create policy qualified_meeting_insert on qualified_meeting for insert
  with check (app_is_admin() or app_is_validator());

create policy revenue_event_read on revenue_event for select
  using (app_is_admin() or app_is_director());
create policy revenue_event_insert on revenue_event for insert
  with check (app_is_admin());

-- O colaborador enxerga a propria premiacao; Comercial nao precisa ver valores alheios.
create policy award_ledger_read on award_ledger for select
  using (app_is_admin() or app_is_director() or staff_id = app_current_staff());
create policy award_ledger_insert on award_ledger for insert
  with check (app_is_admin());

create policy payout_batch_rw on payout_batch for all
  using (app_is_admin() or app_is_director())
  with check (app_is_admin() or app_is_director());
create policy payout_item_read on payout_item for select
  using (app_is_admin() or app_is_director());
create policy payout_item_insert on payout_item for insert
  with check (app_is_admin() or app_is_director());
