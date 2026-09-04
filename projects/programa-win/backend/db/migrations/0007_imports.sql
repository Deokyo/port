-- 0007 pipeline de importacao com staging, previa e confirmacao.
-- Refs: ALTO-04, MED-01, MED-05, AUS-03, Fase 5.

create table import_job (
  id                uuid primary key default gen_random_uuid(),
  filename          text not null,
  content_hash      text not null,          -- sha256 do arquivo recebido
  idempotency_key   text not null unique,   -- hash + escopo; repeticao devolve o mesmo job
  byte_size         bigint not null check (byte_size > 0),
  format            text not null check (format in ('xlsx','csv')),
  status            text not null default 'uploaded' check (status in (
                      'uploaded','validating','validated','awaiting_confirmation',
                      'confirming','completed','rejected','failed','cancelled')),
  catalog_version_id uuid references catalog_version (id) on delete restrict,
  reference_date    date not null,
  total_rows        int  not null default 0,
  valid_rows        int  not null default 0,
  invalid_rows      int  not null default 0,
  created_by        uuid not null references auth_identity (id) on delete restrict,
  created_by_label  text not null,          -- ALTO-01: autoria real vinda da sessao
  confirmed_by      uuid references auth_identity (id) on delete restrict,
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  failure_code      text,
  summary           jsonb not null default '{}'::jsonb
);
create index import_job_status_idx on import_job (status, created_at desc);

-- Staging. Os dados brutos ficam aqui, nunca em log (Fase 5 / SEGURANCA).
create table import_row (
  id            uuid primary key default gen_random_uuid(),
  import_job_id uuid not null references import_job (id) on delete cascade,
  row_number    int  not null check (row_number > 0),
  raw           jsonb not null,
  normalized    jsonb,
  staff_id      uuid references staff_member (id) on delete restrict,
  service_id    uuid references service (id) on delete restrict,
  stage         referral_stage,
  occurred_at   timestamptz,
  status        text not null default 'pending' check (status in (
                  'pending','valid','invalid','skipped','applied','duplicate')),
  error_code    text,
  error_field   text,
  referral_id   uuid references referral (id) on delete restrict,
  constraint import_row_unique unique (import_job_id, row_number)
);
create index import_row_status_idx on import_row (import_job_id, status);

alter table referral
  add constraint referral_source_import_fk
  foreign key (source_import_job_id) references import_job (id) on delete restrict;

alter table duplicate_check
  add constraint duplicate_check_import_row_fk
  foreign key (import_row_id) references import_row (id) on delete set null;
