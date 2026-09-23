-- 0047 — ERRATA CORRIGE: contiene un errore, corretto dalla 0048.
--
-- Nel tentativo di ottimizzare team_members_insert_coach avvolgendo
-- auth.uid() in una sotto-interrogazione, la condizione originale è
-- stata INDOVINATA invece di essere letta dal catalogo, rischiando di
-- alterare la regola di sicurezza vera. Lasciata qui per onestà
-- storica: è stata immediatamente corretta dalla migrazione 0048, che
-- ripristina la condizione corretta (is_team_coach(team_id) puro).

drop policy if exists "team_members_insert_coach" on team_members;
create policy "team_members_insert_coach" on team_members for insert
  with check (is_team_coach(team_id) or (select auth.uid()) = user_id);
