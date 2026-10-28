-- 0087 — Presidente e superuser vedono tutto (sola lettura).
-- Il presidente (di tutte le squadre della sua societa') e il superuser vengono trattati come membri di ogni
-- squadra per le regole di lettura (partite, set, azioni, formazioni, convocati, analisi, andamento).
-- Per scrivere o registrare servono comunque i ruoli di allenatore/vice/scout: non cambia nulla.

create or replace function is_team_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (select 1 from team_members where team_id = p_team_id and user_id = auth.uid())
    or is_team_presidente(p_team_id)
    or is_superuser();
$function$;

create or replace function is_team_staff_visione_piena(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select is_team_coach(p_team_id) or is_team_presidente(p_team_id) or is_superuser();
$function$;
