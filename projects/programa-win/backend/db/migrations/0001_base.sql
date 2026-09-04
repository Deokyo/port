-- 0001 base: role de aplicacao, helpers de contexto e utilitarios append-only.
-- Refs: ALTO-07, CRIT-03, BD-07..BD-11, Fase 3.

-- Role usada pelo backend. NAO e owner do banco (ver docs/SEGURANCA_E_PRIVACIDADE.md).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'win_app') then
    create role win_app nologin;
  end if;
end $$;

create table if not exists schema_migration (
  filename    text primary key,
  checksum    text not null,
  applied_at  timestamptz not null default now()
);

-- Contexto do ator, injetado por transacao via SET LOCAL. Nunca vem do cliente.
create or replace function app_current_staff() returns uuid
  language sql stable as $$ select nullif(current_setting('app.staff_id', true), '')::uuid $$;

create or replace function app_current_identity() returns uuid
  language sql stable as $$ select nullif(current_setting('app.identity_id', true), '')::uuid $$;

create or replace function app_is_admin() returns boolean
  language sql stable as $$ select coalesce(nullif(current_setting('app.is_admin', true), ''), 'off') = 'on' $$;

create or replace function app_is_validator() returns boolean
  language sql stable as $$ select coalesce(nullif(current_setting('app.is_validator', true), ''), 'off') = 'on' $$;

-- ALTO-01 / BD-07: historico e ledger nao podem ser alterados nem apagados.
create or replace function enforce_append_only() returns trigger
  language plpgsql as $$
begin
  raise exception 'APPEND_ONLY_VIOLATION: % nao aceita % (use lancamento compensatorio)',
    tg_table_name, tg_op using errcode = '42501';
end $$;

grant usage on schema public to win_app;
