-- 0005 regras versionaveis e ledger de pontos append-only.
-- Refs: ALTO-02, ALTO-05, AUS-05, BD-04, RP-03, Fase 2.

create table business_rule (
  rule_key      text not null,
  version       int  not null check (version > 0),
  name          text not null,
  status        text not null default 'proposed'
                  check (status in ('proposed','pending','approved','retired')),
  statement     text not null,
  definition    jsonb not null default '{}'::jsonb,
  approver_name text,
  approver_role text,
  approved_at   timestamptz,
  effective_from timestamptz,
  effective_to   timestamptz,
  source        text not null,
  created_at    timestamptz not null default now(),
  primary key (rule_key, version),
  -- ALTO-05: e impossivel marcar approved sem aprovador e vigencia identificaveis.
  constraint business_rule_approval_requires_approver check (
    status <> 'approved'
    or (approver_name is not null and approved_at is not null and effective_from is not null)
  )
);
create index business_rule_status_idx on business_rule (rule_key, status);

-- Tabela de pontos por etapa, sempre presa a uma versao de regra (AUS-05).
create table points_rule (
  id            uuid primary key default gen_random_uuid(),
  rule_key      text not null,
  rule_version  int  not null,
  stage         referral_stage not null,
  points        int  not null check (points >= 0),
  constraint points_rule_rule_fk foreign key (rule_key, rule_version)
    references business_rule (rule_key, version) on delete restrict,
  constraint points_rule_stage_unique unique (rule_key, rule_version, stage)
);

-- BD-04: ledger append-only. Correcao so por lancamento compensatorio.
create table points_ledger (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid not null references staff_member (id) on delete restrict,
  referral_id       uuid references referral (id) on delete restrict,
  stage             referral_stage,
  amount            int  not null,
  kind              text not null check (kind in ('grant','reversal','adjustment','correction')),
  origin            text not null check (origin in ('referral_stage','import','manual','migration')),
  rule_key          text not null,
  rule_version      int  not null,
  idempotency_key   text not null unique,
  effective_at      timestamptz not null,
  recorded_at       timestamptz not null default now(),
  actor_identity_id uuid references auth_identity (id) on delete restrict,
  actor_label       text not null,
  correction_of_entry_id uuid references points_ledger (id) on delete restrict,
  reason            text,
  constraint points_ledger_rule_fk foreign key (rule_key, rule_version)
    references business_rule (rule_key, version) on delete restrict,
  constraint points_ledger_correction_requires_reason
    check (correction_of_entry_id is null or reason is not null),
  constraint points_ledger_nonzero check (amount <> 0)
);
create index points_ledger_staff_idx     on points_ledger (staff_id, effective_at);
create index points_ledger_referral_idx  on points_ledger (referral_id);
create trigger points_ledger_append_only
  before update or delete on points_ledger
  for each row execute function enforce_append_only();

create or replace view points_balance as
  select staff_id, sum(amount)::int as balance, max(effective_at) as last_entry_at
  from points_ledger group by staff_id;
