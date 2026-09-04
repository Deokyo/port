-- 0009 privilegios minimos e Row Level Security.
-- Refs: BD-08, BD-11, CRIT-02, AP-06, Fase 3/4.
-- O backend conecta como win_app, que NAO e owner das tabelas: por isso a RLS o alcanca.

-- Escrita normal
grant select, insert, update, delete on
  staff_member, auth_identity, auth_session, identity_role, admin_bootstrap,
  referral, duplicate_check, territory_progress, cross_sell_opportunity,
  import_job, import_row, ranking_cycle, notification, business_rule, points_rule,
  achievement
to win_app;

-- Somente leitura (catalogo e RBAC sao alterados por migration/seed)
grant select on catalog_version, territory, service, subproduct, service_alias,
  role, permission, role_permission, schema_migration, points_balance to win_app;

-- Append-only: sem UPDATE e sem DELETE nem no nivel de privilegio (defesa dupla)
grant select, insert on
  points_ledger, audit_event, referral_stage_event, ranking_snapshot, achievement_grant
to win_app;

-- A view precisa executar com os privilegios de quem consulta, senao burla a RLS.
alter view points_balance set (security_invoker = true);

alter table staff_member          enable row level security;
alter table referral              enable row level security;
alter table referral_stage_event  enable row level security;
alter table points_ledger         enable row level security;
alter table notification          enable row level security;
alter table achievement_grant     enable row level security;
alter table territory_progress    enable row level security;
alter table import_job            enable row level security;
alter table import_row            enable row level security;
alter table audit_event           enable row level security;

-- Participante enxerga apenas o proprio registro; admin e validador enxergam todos.
create policy staff_read on staff_member for select
  using (app_is_admin() or app_is_validator() or id = app_current_staff());
create policy staff_write on staff_member for all
  using (app_is_admin()) with check (app_is_admin());

create policy referral_read on referral for select
  using (app_is_admin() or app_is_validator() or staff_id = app_current_staff());
create policy referral_write on referral for all
  using (app_is_admin() or app_is_validator())
  with check (app_is_admin() or app_is_validator());

create policy stage_event_read on referral_stage_event for select
  using (app_is_admin() or app_is_validator()
         or exists (select 1 from referral r
                    where r.id = referral_stage_event.referral_id
                      and r.staff_id = app_current_staff()));
create policy stage_event_insert on referral_stage_event for insert
  with check (app_is_admin() or app_is_validator());

create policy ledger_read on points_ledger for select
  using (app_is_admin() or staff_id = app_current_staff());
create policy ledger_insert on points_ledger for insert
  with check (app_is_admin());

create policy notification_read on notification for select
  using (app_is_admin() or staff_id = app_current_staff());
create policy notification_write on notification for all
  using (app_is_admin() or staff_id = app_current_staff())
  with check (app_is_admin() or staff_id = app_current_staff());

create policy grant_read on achievement_grant for select
  using (app_is_admin() or staff_id = app_current_staff());
create policy grant_insert on achievement_grant for insert
  with check (app_is_admin());

create policy progress_read on territory_progress for select
  using (app_is_admin() or app_is_validator() or staff_id = app_current_staff());
create policy progress_write on territory_progress for all
  using (app_is_admin()) with check (app_is_admin());

-- Importacao e area exclusivamente administrativa.
create policy import_job_admin on import_job for all
  using (app_is_admin()) with check (app_is_admin());
create policy import_row_admin on import_row for all
  using (app_is_admin()) with check (app_is_admin());

-- Auditoria: qualquer ator pode gerar evento (inclusive negacoes), so admin le.
create policy audit_read on audit_event for select using (app_is_admin());
create policy audit_insert on audit_event for insert with check (true);
