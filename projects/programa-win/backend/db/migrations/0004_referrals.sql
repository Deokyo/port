-- 0004 indicacoes, historico de etapas e duplicidade.
-- Refs: ALTO-03, ALTO-04, MED-04, RP-02..RP-08, BD-03, BD-05, AUS-08.

-- MED-04: vocabulario de PIPELINE COMERCIAL. Nao se mistura com estado de territorio.
create type referral_stage as enum (
  'identified', 'meeting_scheduled', 'meeting_held', 'proposal_sent', 'sale_won', 'lost'
);

-- MED-04: vocabulario de ESTADO DE TERRITORIO. Vocabulario distinto, tabela distinta.
create type territory_state as enum ('locked', 'in_progress', 'conquered');

create table referral (
  id                 uuid primary key default gen_random_uuid(),
  staff_id           uuid not null references staff_member (id) on delete restrict,
  service_id         uuid not null references service (id) on delete restrict,
  subproduct_id      uuid references subproduct (id) on delete restrict,
  client_company     text not null,          -- DADO DE TERCEIRO (AUS-06). Nunca em DTO publico.
  client_reference   text,                   -- codigo interno do CRM, quando houver
  current_stage      referral_stage not null default 'identified',
  occurred_at        timestamptz not null,   -- momento efetivo do fato (MED-06)
  recorded_at        timestamptz not null default now(),
  status             text not null default 'active' check (status in ('active','inactive')),
  inactivated_at     timestamptz,
  dedupe_fingerprint text,                   -- preenchido apenas por regra de duplicidade APROVADA
  source             text not null default 'manual'
                       check (source in ('manual','import','migration','seed')),
  source_import_job_id uuid,
  created_by         uuid references auth_identity (id) on delete restrict,
  updated_at         timestamptz not null default now(),
  constraint referral_inactive_consistency
    check ((status = 'inactive') = (inactivated_at is not null))
);
create index referral_staff_idx      on referral (staff_id);
create index referral_service_idx    on referral (service_id);
create index referral_occurred_idx   on referral (occurred_at);
create index referral_stage_idx      on referral (current_stage);
create index referral_import_idx     on referral (source_import_job_id);

-- ALTO-04/RP-06: unicidade real no banco, ativada quando a regra de duplicidade for
-- aprovada e o fingerprint passar a ser preenchido. Ate la o indice existe e nao bloqueia
-- nada (todos os fingerprints sao NULL), evitando migration adicional depois da decisao.
create unique index referral_dedupe_uq on referral (dedupe_fingerprint)
  where dedupe_fingerprint is not null and status = 'active';

-- BD-03: historico append-only das transicoes.
create table referral_stage_event (
  id              uuid primary key default gen_random_uuid(),
  referral_id     uuid not null references referral (id) on delete restrict,
  from_stage      referral_stage,
  to_stage        referral_stage not null,
  occurred_at     timestamptz not null,
  recorded_at     timestamptz not null default now(),
  actor_identity_id uuid references auth_identity (id) on delete restrict,
  actor_label     text not null,             -- autoria real, nunca literal fixo (ALTO-01)
  rule_version    text,                      -- versao da regra de transicao vigente
  idempotency_key text not null,
  note            text,
  constraint referral_stage_event_idem_key unique (referral_id, idempotency_key)
);
create index referral_stage_event_referral_idx on referral_stage_event (referral_id, occurred_at);
create trigger referral_stage_event_append_only
  before update or delete on referral_stage_event
  for each row execute function enforce_append_only();

-- BD-05: decisoes de duplicidade ficam registradas, nunca implicitas.
create table duplicate_check (
  id               uuid primary key default gen_random_uuid(),
  fingerprint      text not null,
  referral_id      uuid references referral (id) on delete restrict,
  candidate_referral_id uuid references referral (id) on delete restrict,
  import_row_id    uuid,
  rule_version     text not null,
  decision         text not null check (decision in ('pending','duplicate','distinct')),
  decided_by       uuid references auth_identity (id) on delete restrict,
  decided_at       timestamptz,
  created_at       timestamptz not null default now()
);
create index duplicate_check_fingerprint_idx on duplicate_check (fingerprint);

-- Progresso por territorio. Estado so muda por regra APROVADA de threshold (RP-07).
create table territory_progress (
  id             uuid primary key default gen_random_uuid(),
  staff_id       uuid not null references staff_member (id) on delete restrict,
  territory_id   uuid not null references territory (id) on delete restrict,
  state          territory_state not null default 'locked',
  services_won   int not null default 0 check (services_won >= 0),
  services_total int not null default 0 check (services_total >= 0),
  rule_version   text,
  updated_at     timestamptz not null default now(),
  constraint territory_progress_unique unique (staff_id, territory_id),
  constraint territory_progress_bounds check (services_won <= services_total)
);

create table cross_sell_opportunity (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid not null references staff_member (id) on delete restrict,
  client_company text not null,
  service_id    uuid not null references service (id) on delete restrict,
  status        text not null default 'proposed'
                  check (status in ('proposed','accepted','discarded')),
  rule_version  text,
  detected_at   timestamptz not null default now()
);
create index cross_sell_staff_idx on cross_sell_opportunity (staff_id);
