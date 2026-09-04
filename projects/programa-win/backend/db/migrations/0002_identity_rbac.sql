-- 0002 identidade, RBAC e sessoes.
-- Refs: CRIT-01, CRIT-03, AP-01..AP-09, AUS-01, AUS-11, Fase 4.

-- Entidade de dominio: a pessoa. Separada da identidade autenticada (BD-01).
create table staff_member (
  id               uuid primary key default gen_random_uuid(),
  external_code    text not null,                    -- matricula/ID corporativo estavel (AUS-01)
  display_name     text not null,
  business_unit    text,
  status           text not null default 'active'
                     check (status in ('active','inactive')),
  inactivated_at   timestamptz,
  inactivation_reason text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint staff_member_external_code_key unique (external_code),
  constraint staff_member_inactive_consistency
    check ((status = 'inactive') = (inactivated_at is not null))
);
create index staff_member_status_idx on staff_member (status);
comment on column staff_member.external_code is
  'Chave estavel de negocio. ALTO-03/AUS-01: nome NUNCA e usado como identidade.';

-- Identidade autenticada, fornecida pelo provedor OIDC (BD-01).
create table auth_identity (
  id             uuid primary key default gen_random_uuid(),
  issuer         text not null,
  subject        text not null,
  email          text,
  staff_id       uuid references staff_member (id) on delete restrict,
  status         text not null default 'active' check (status in ('active','disabled')),
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  constraint auth_identity_issuer_subject_key unique (issuer, subject)
);
create index auth_identity_staff_idx on auth_identity (staff_id);

create table role (
  key          text primary key,
  name         text not null,
  description  text not null,
  is_system    boolean not null default false,
  status       text not null default 'proposed'
                 check (status in ('proposed','approved','retired'))
);
comment on column role.status is
  'ALTO-05/D-10: papeis nascem como proposed. Aprovacao formal muda para approved.';

create table permission (
  key          text primary key,
  description  text not null
);

create table role_permission (
  role_key        text not null references role (key) on delete cascade,
  permission_key  text not null references permission (key) on delete cascade,
  primary key (role_key, permission_key)
);

create table identity_role (
  identity_id  uuid not null references auth_identity (id) on delete cascade,
  role_key     text not null references role (key) on delete restrict,
  granted_at   timestamptz not null default now(),
  granted_by   uuid references auth_identity (id),
  primary key (identity_id, role_key)
);

-- Sessao opaca. Token nunca e persistido em claro (apenas SHA-256).
create table auth_session (
  id             uuid primary key default gen_random_uuid(),
  identity_id    uuid not null references auth_identity (id) on delete cascade,
  token_hash     text not null unique,
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz,
  user_agent_hash text,
  constraint auth_session_expiry_after_creation check (expires_at > created_at)
);
create index auth_session_identity_idx on auth_session (identity_id);
create index auth_session_expiry_idx on auth_session (expires_at) where revoked_at is null;

-- AP-03: bootstrap do primeiro administrador, auditavel e inativo por padrao.
create table admin_bootstrap (
  id            uuid primary key default gen_random_uuid(),
  token_hash    text not null unique,
  created_at    timestamptz not null default now(),
  consumed_at   timestamptz,
  consumed_by   uuid references auth_identity (id),
  note          text
);
