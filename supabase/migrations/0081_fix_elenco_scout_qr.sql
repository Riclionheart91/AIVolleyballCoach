-- Fix: scout_anonimi_elenco andava sempre in errore ("column reference id is ambiguous"):
-- nella select sulla partita `id` coincideva con la colonna `id` restituita dalla funzione.
-- Per questo lo staff non vedeva mai chi era collegato col QR.
create or replace function scout_anonimi_elenco(p_match_id uuid)
returns table (id uuid, nome text, escluso boolean, creato_il timestamptz, ha_turno boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.team_id into v_team_id from matches m where m.id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  return query
    select a.id, a.nome, a.escluso, a.creato_il,
           coalesce((select t.user_id = a.user_id and t.ultimo_segnale > now() - interval '60 seconds' from scout_turno_partita t where t.match_id = a.match_id), false)
    from scout_anonimi_partita a
    where a.match_id = p_match_id
    order by a.creato_il;
end;
$$;
