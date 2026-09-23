-- 0042 — La formazione resta modificabile finché il set non è iniziato
--
-- BUG: imposta_formazione_iniziale rifiutava qualunque modifica una
-- volta che le righe esistevano, anche a partita non ancora avviata.
-- Il blocco deve scattare solo quando il set ha già eventi registrati.

create or replace function imposta_formazione_iniziale(p_set_id uuid, p_posizioni jsonb, p_chi_serve text default 'noi')
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_chiave text;
  v_athlete uuid;
  v_conteggio integer := 0;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  if exists (select 1 from match_events where set_id = p_set_id) then
    raise exception 'Il set è già iniziato: la formazione non può più essere cambiata, usa i cambi';
  end if;

  delete from match_set_lineups where set_id = p_set_id;
  delete from rimpiazzi_libero where set_id = p_set_id;

  for v_chiave in select jsonb_object_keys(p_posizioni) loop
    v_athlete := (p_posizioni ->> v_chiave)::uuid;

    if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = v_athlete) then
      raise exception 'Una delle persone indicate non è tra i convocati';
    end if;

    insert into match_set_lineups (set_id, athlete_id, posizione, in_campo)
    values (p_set_id, v_athlete, v_chiave::integer, true);
    v_conteggio := v_conteggio + 1;
  end loop;

  if v_conteggio <> 6 then
    raise exception 'Servono esattamente 6 posizioni, ne sono arrivate %', v_conteggio;
  end if;

  update match_sets
  set squadra_al_servizio = p_chi_serve,
      chi_ha_servito_per_primo = p_chi_serve
  where id = p_set_id;
end;
$$;
