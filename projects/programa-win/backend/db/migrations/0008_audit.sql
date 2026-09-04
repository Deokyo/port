-- 0008 trilha de auditoria append-only com autoria real.
-- Refs: CRIT-03, ALTO-01, BD-07, AP-08.

create table audit_event (
  id             uuid primary key default gen_random_uuid(),
  occurred_at    timestamptz not null default now(),
  actor_identity_id uuid references auth_identity (id) on delete restrict,
  actor_label    text not null,           -- 'anonymous', 'system:migrate', ou rotulo da sessao
  actor_roles    text[] not null default '{}',
  action         text not null,
  resource_type  text not null,
  resource_id    text,
  outcome        text not null check (outcome in ('allowed','denied','error')),
  reason_code    text,
  correlation_id text,
  ip_hash        text,                     -- hash, nunca IP em claro
  metadata       jsonb not null default '{}'::jsonb  -- redigido na aplicacao, sem PII
);
create index audit_event_occurred_idx on audit_event (occurred_at desc);
create index audit_event_actor_idx    on audit_event (actor_identity_id, occurred_at desc);
create index audit_event_resource_idx on audit_event (resource_type, resource_id);
create trigger audit_event_append_only
  before update or delete on audit_event
  for each row execute function enforce_append_only();
