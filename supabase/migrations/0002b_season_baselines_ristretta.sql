-- ============================================================
-- 0002b — RLS ristretta su season_baselines
--
-- Era dentro 0001c_ruoli_estesi.sql, ma quel file gira PRIMA di
-- 0002_f2_stagioni.sql (che crea "seasons" e "season_baselines") —
-- su un database vuoto lo script falliva subito con "relation
-- season_baselines does not exist". Spostata qui, che gira dopo.
-- ============================================================

drop policy if exists "season_baselines_select_member" on season_baselines;
drop policy if exists "season_baselines_select_ristretta" on season_baselines;
create policy "season_baselines_select_ristretta" on season_baselines for select using (
  is_team_staff_visione_piena((select team_id from seasons where id = season_id))
  or athlete_id = mio_atleta_id((select team_id from seasons where id = season_id))
  or is_superuser()
);
