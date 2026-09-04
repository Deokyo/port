-- 0006 ciclos de ranking, snapshots, conquistas e notificacoes.
-- Refs: AUS-04 (fechamento de ciclo), RP-10, BD-06, BAI-03.

create table ranking_cycle (
  id            uuid primary key default gen_random_uuid(),
  label         text not null unique,
  periodicity   text not null check (periodicity in ('weekly','monthly','quarterly')),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'open'
                  check (status in ('open','closed','recomputing')),
  closed_at     timestamptz,
  closed_by     uuid references auth_identity (id) on delete restrict,
  rule_version  text,
  constraint ranking_cycle_window check (ends_at > starts_at)
);
create index ranking_cycle_window_idx on ranking_cycle (starts_at, ends_at);

-- AUS-04: um ciclo fechado vira snapshot imutavel. Reimportacao retroativa nao reescreve.
create table ranking_snapshot (
  id            uuid primary key default gen_random_uuid(),
  cycle_id      uuid not null references ranking_cycle (id) on delete restrict,
  staff_id      uuid not null references staff_member (id) on delete restrict,
  position      int not null check (position > 0),
  points        int not null,
  referrals     int not null default 0,
  tiebreak_note text,
  generated_at  timestamptz not null default now(),
  constraint ranking_snapshot_unique unique (cycle_id, staff_id)
);
create index ranking_snapshot_cycle_idx on ranking_snapshot (cycle_id, position);
create trigger ranking_snapshot_append_only
  before update or delete on ranking_snapshot
  for each row execute function enforce_append_only();

create table achievement (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  name          text not null,
  description   text not null,
  rule_key      text,
  rule_version  int,
  status        text not null default 'proposed'
                  check (status in ('proposed','approved','retired')),
  constraint achievement_rule_fk foreign key (rule_key, rule_version)
    references business_rule (rule_key, version) on delete restrict
);

create table achievement_grant (
  id              uuid primary key default gen_random_uuid(),
  achievement_id  uuid not null references achievement (id) on delete restrict,
  staff_id        uuid not null references staff_member (id) on delete restrict,
  granted_at      timestamptz not null default now(),
  rule_version    text not null,
  idempotency_key text not null unique,
  actor_label     text not null,
  constraint achievement_grant_unique unique (achievement_id, staff_id)
);
create trigger achievement_grant_append_only
  before update or delete on achievement_grant
  for each row execute function enforce_append_only();

create table notification (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff_member (id) on delete cascade,
  kind         text not null,
  title        text not null,
  body         text not null,
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  -- Nenhum envio externo. Fase 6 do plano; hoje a notificacao so existe in-app.
  delivery     text not null default 'in_app' check (delivery in ('in_app'))
);
create index notification_staff_idx on notification (staff_id, created_at desc);
