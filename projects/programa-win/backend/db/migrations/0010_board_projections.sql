-- 0010 projecoes agregadas do WIN Board.
-- Refs: ALTO-06, AP-06, Fase 6.
--
-- Problema real encontrado no teste E2E: a RLS (correta) limita o participante as
-- proprias indicacoes, mas o WIN Board precisa mostrar numeros do PROGRAMA (mapa,
-- ranking, funil). Duas saidas ruins seriam afrouxar a policy ou consultar o banco
-- como owner na aplicacao — as duas anulariam a RLS para consultas arbitrarias.
--
-- Solucao adotada: funcoes SECURITY DEFINER com SQL fixo na migration. O que pode
-- atravessar a RLS e exatamente este conjunto de agregados, revisavel em code review,
-- e nada mais. Nenhuma delas devolve empresa cliente, contato ou observacao interna.

-- Impede que um participante peca o recorte de outra pessoa passando outro uuid.
-- Retorna boolean (e nao void) para poder ser usada como guarda no WHERE das projecoes.
create or replace function board_assert_scope(p_staff uuid) returns boolean
  language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if p_staff is not null
     and not app_is_admin()
     and not app_is_validator()
     and p_staff is distinct from app_current_staff() then
    raise exception 'SCOPE_VIOLATION: recorte de terceiro nao permitido'
      using errcode = '42501';
  end if;
  return true;
end $$;

create or replace function board_totals(p_from timestamptz, p_to timestamptz)
  returns table (o_referrals int, o_wins int, o_points int)
  language sql stable security definer set search_path = public, pg_temp as $$
  select count(r.id)::int,
         count(r.id) filter (where r.current_stage = 'sale_won')::int,
         coalesce((select sum(l.amount) from points_ledger l
                    where l.effective_at between p_from and p_to), 0)::int
    from referral r
   where r.status = 'active' and r.occurred_at between p_from and p_to
$$;

create or replace function board_funnel(p_from timestamptz, p_to timestamptz)
  returns table (o_stage text, o_count int)
  language sql stable security definer set search_path = public, pg_temp as $$
  select r.current_stage::text, count(*)::int
    from referral r
   where r.status = 'active' and r.occurred_at between p_from and p_to
   group by r.current_stage
$$;

create or replace function board_territories(p_staff uuid)
  returns table (
    o_territory_slug text, o_territory_name text,
    o_service_slug text, o_service_name text, o_wins int
  )
  language sql stable security definer set search_path = public, pg_temp as $$
  select tr.slug, tr.name, s.slug, s.name,
         count(r.id) filter (
           where r.current_stage = 'sale_won'
             and (p_staff is null or r.staff_id = p_staff)
         )::int
    from territory tr
    join service s on s.territory_id = tr.id
    join catalog_version cv on cv.id = tr.catalog_version_id and cv.status = 'active'
    left join referral r on r.service_id = s.id and r.status = 'active'
   where board_assert_scope(p_staff)
   group by tr.slug, tr.name, tr.display_order, s.slug, s.name, s.display_order
   order by tr.display_order, s.display_order
$$;

create or replace function board_ranking(p_from timestamptz, p_to timestamptz, p_limit int)
  returns table (o_staff_id uuid, o_display_name text, o_points int, o_referrals int)
  language sql stable security definer set search_path = public, pg_temp as $$
  select m.id, m.display_name,
         coalesce((select sum(l.amount) from points_ledger l
                    where l.staff_id = m.id and l.effective_at between p_from and p_to), 0)::int,
         count(r.id)::int
    from staff_member m
    left join referral r on r.staff_id = m.id and r.status = 'active'
         and r.occurred_at between p_from and p_to
   where m.status = 'active'
   group by m.id, m.display_name, m.external_code
  having count(r.id) > 0
   -- Desempate deterministico e auditavel (proposta D-08, ainda pendente de aprovacao).
   order by 3 desc, 4 desc, m.external_code asc
   limit greatest(p_limit, 1)
$$;

revoke all on function board_totals(timestamptz, timestamptz) from public;
revoke all on function board_funnel(timestamptz, timestamptz) from public;
revoke all on function board_territories(uuid) from public;
revoke all on function board_ranking(timestamptz, timestamptz, int) from public;
revoke all on function board_assert_scope(uuid) from public;

grant execute on function board_totals(timestamptz, timestamptz) to win_app;
grant execute on function board_funnel(timestamptz, timestamptz) to win_app;
grant execute on function board_territories(uuid) to win_app;
grant execute on function board_ranking(timestamptz, timestamptz, int) to win_app;
grant execute on function board_assert_scope(uuid) to win_app;
