-- 0003 catalogo versionavel de territorios, servicos e subprodutos.
-- Refs: MED-02, RP-01, BD-02. Substitui a classificacao por substring.

create table catalog_version (
  id            uuid primary key default gen_random_uuid(),
  label         text not null unique,
  status        text not null default 'active' check (status in ('draft','active','retired')),
  source        text not null,
  effective_from timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table territory (
  id                 uuid primary key default gen_random_uuid(),
  catalog_version_id uuid not null references catalog_version (id) on delete restrict,
  slug               text not null,
  name               text not null,
  display_order      int  not null default 0,
  constraint territory_slug_per_version_key unique (catalog_version_id, slug)
);

create table service (
  id            uuid primary key default gen_random_uuid(),
  territory_id  uuid not null references territory (id) on delete restrict,
  slug          text not null,
  name          text not null,
  display_order int not null default 0,
  constraint service_slug_per_territory_key unique (territory_id, slug)
);

create table subproduct (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references service (id) on delete restrict,
  slug        text not null,
  name        text not null,
  constraint subproduct_slug_per_service_key unique (service_id, slug)
);

-- Aliases explicitos de importacao. Sem alias => linha rejeitada, nunca default (MED-02).
create table service_alias (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references service (id) on delete cascade,
  alias_key   text not null,
  catalog_version_id uuid not null references catalog_version (id) on delete cascade,
  constraint service_alias_key_per_version unique (catalog_version_id, alias_key)
);
create index service_alias_service_idx on service_alias (service_id);
