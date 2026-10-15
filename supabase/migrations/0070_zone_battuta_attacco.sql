-- Zone di battuta e attacco (modalita' facoltativa, attivata a mano in partita).
-- Il campo e' diviso in 6 zone, numerate come le posizioni:
--     4 3 2   (prima linea)
--     5 6 1   (seconda linea)
-- zona_arrivo  = dove e' caduta la palla nel campo avversario;
-- zona_partenza = zona da cui parte l'attacco (ricavata dalla rotazione).
-- Restano vuote per chi non usa la modalita', e per tutti gli eventi gia' registrati.

alter table match_events
  add column if not exists zona_arrivo smallint check (zona_arrivo between 1 and 6),
  add column if not exists zona_partenza smallint check (zona_partenza between 1 and 6);

-- Aggiunge le zone a un evento appena registrato (un secondo passo, cosi' un
-- eventuale errore non fa perdere l'evento stesso).
create or replace function imposta_zone_evento(p_event_id uuid, p_zona_arrivo integer, p_zona_partenza integer default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_team_id uuid;
  v_stato text;
  v_skill text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if p_zona_arrivo is not null and (p_zona_arrivo < 1 or p_zona_arrivo > 6) then raise exception 'Zona di arrivo non valida'; end if;
  if p_zona_partenza is not null and (p_zona_partenza < 1 or p_zona_partenza > 6) then raise exception 'Zona di partenza non valida'; end if;

  select e.match_id, m.team_id, m.stato, e.skill into v_match_id, v_team_id, v_stato, v_skill
  from match_events e join matches m on m.id = e.match_id
  where e.id = p_event_id;
  if v_match_id is null then raise exception 'Evento non trovato'; end if;

  if not (is_team_scout(v_team_id) or is_scout_ospite(v_match_id)) then raise exception 'Permesso negato'; end if;
  if v_stato <> 'in_corso' then raise exception 'La partita non e'' in corso'; end if;
  if v_skill not in ('Servizio', 'Attacco') then raise exception 'Le zone si registrano solo per battuta e attacco'; end if;

  update match_events set zona_arrivo = p_zona_arrivo, zona_partenza = p_zona_partenza where id = p_event_id;
end;
$$;

revoke execute on function imposta_zone_evento(uuid, integer, integer) from public, anon;
grant execute on function imposta_zone_evento(uuid, integer, integer) to authenticated;

-- Report per zona di una partita: una riga per giocatore, fondamentale, zona
-- di partenza e zona di arrivo. Stessa visibilita' dell'analisi per persona:
-- staff e scout vedono tutti, un'atleta vede solo se stessa.
create or replace function analisi_zone_partita(p_match_id uuid)
returns table (
  athlete_id uuid,
  fondamentale text,
  zona_partenza integer,
  zona_arrivo integer,
  azioni integer,
  punti integer,
  errori integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_mio uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.team_id into v_team_id from matches m where m.id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  v_mio := mio_atleta_id(v_team_id);
  if not (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id) or v_mio is not null) then
    raise exception 'Permesso negato';
  end if;

  return query
  select me.athlete_id, me.skill::text, me.zona_partenza::integer, me.zona_arrivo::integer,
         count(*)::integer,
         (count(*) filter (where me.esito = 'punto'))::integer,
         (count(*) filter (where me.esito = 'errore'))::integer
  from match_events me
  where me.match_id = p_match_id
    and me.athlete_id is not null
    and me.skill in ('Servizio', 'Attacco')
    and (me.zona_arrivo is not null or me.zona_partenza is not null)
    and (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id) or me.athlete_id = v_mio)
  group by me.athlete_id, me.skill, me.zona_partenza, me.zona_arrivo
  order by me.athlete_id, me.skill;
end;
$$;

revoke execute on function analisi_zone_partita(uuid) from public, anon;
grant execute on function analisi_zone_partita(uuid) to authenticated;
