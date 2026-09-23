-- 0050 — Il Libero può entrare in posizione 1 se non siamo al servizio
--
-- ERRORE PRECEDENTE (0035): si bloccava sempre la posizione 1 per il
-- Libero, ragionando solo su "non può servire". Ma la posizione 1 non
-- è sempre la battuta: lo è solo quando è la NOSTRA squadra al
-- servizio. Se è l'avversario a servire, la posizione 1 per noi è una
-- normale posizione di seconda linea in ricezione, dove il Libero
-- gioca regolarmente.

create or replace function rimpiazza_con_libero(p_set_id uuid, p_libero_id uuid, p_titolare_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
  v_servizio text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_libero_id and is_libero = true) then
    raise exception 'Questa persona non è indicata come Libero nella distinta';
  end if;

  select posizione into v_posizione from match_set_lineups
  where set_id = p_set_id and athlete_id = p_titolare_id and in_campo = true;
  if v_posizione is null then raise exception 'Chi deve essere rimpiazzato non è in campo'; end if;

  if v_posizione not in (1, 5, 6) then
    raise exception 'Il Libero può entrare solo in seconda linea (posizioni 5, 6, 1): la posizione indicata è %', v_posizione;
  end if;

  if v_posizione = 1 then
    select squadra_al_servizio into v_servizio from match_sets where id = p_set_id;
    if v_servizio = 'noi' then
      raise exception 'In questo momento la posizione 1 è alla battuta (siamo al servizio): il Libero non può servire';
    end if;
  end if;

  if exists (select 1 from rimpiazzi_libero where set_id = p_set_id and uscito_il is null) then
    raise exception 'C''è già un Libero in campo: fallo uscire prima';
  end if;

  update match_set_lineups set in_campo = false, posizione = null
  where set_id = p_set_id and athlete_id = p_titolare_id;

  insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
  values (p_set_id, p_libero_id, true, v_posizione)
  on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione;

  insert into rimpiazzi_libero (set_id, libero_id, titolare_id, posizione)
  values (p_set_id, p_libero_id, p_titolare_id, v_posizione);
end;
$$;
