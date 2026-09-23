-- 0048 — Corregge l'errore della 0047
--
-- La migrazione precedente aveva riscritto team_members_insert_coach
-- indovinando la condizione originale invece di leggerla dal catalogo.
-- Qui si ripristina la condizione corretta: la stessa usata ovunque
-- nel progetto per l'inserimento (is_team_coach(team_id) puro), senza
-- clausole aggiuntive inventate.

drop policy if exists "team_members_insert_coach" on team_members;
create policy "team_members_insert_coach" on team_members for insert
  with check (is_team_coach(team_id));
