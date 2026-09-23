-- 0038 — Linguaggio neutro nei messaggi di errore mostrati all'utente
--
-- I messaggi delle funzioni arrivano fino all'interfaccia: la
-- revisione linguistica non poteva fermarsi al codice dell'app.
-- In italiano "atleta" al singolare è già neutro: si interviene sui
-- participi e sugli aggettivi concordati ("convocata", "uscente",
-- "indicata"), sostituendoli con formulazioni impersonali.

create or replace function cambia_giocatore(p_set_id uuid, p_atleta_uscente uuid, p_atleta_entrante uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
begin
  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  select posizione into v_posizione from match_set_lineups
  where set_id = p_set_id and athlete_id = p_atleta_uscente and in_campo = true;
  if v_posizione is null then raise exception 'Chi deve uscire non risulta in campo in questo set'; end if;

  if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_atleta_entrante) then
    raise exception 'Chi deve entrare non è tra i convocati di questa partita';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = true) then
    raise exception 'Chi deve entrare è già in campo';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = false) then
    raise exception 'Chi deve entrare è già uscito in questo set e non può rientrare';
  end if;

  update match_set_lineups set in_campo = false, posizione = null
  where set_id = p_set_id and athlete_id = p_atleta_uscente;

  insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
  values (p_set_id, p_atleta_entrante, true, v_posizione)
  on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione;
end;
$$;

create or replace function rimpiazza_con_libero(p_set_id uuid, p_libero_id uuid, p_titolare_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
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
    raise exception 'Il Libero non può servire: non può entrare in posizione 1';
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

create or replace function carenze_atleta(p_athlete_id uuid, p_quante integer default 3)
returns table(fondamentale text, media numeric, numero_valutazioni integer)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from athletes where id = p_athlete_id;
  if v_team_id is null then raise exception 'Persona non trovata in anagrafica'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or p_athlete_id = mio_atleta_id(v_team_id)) then
    raise exception 'Permesso negato';
  end if;

  return query
    select e.fondamentale, round(avg(e.punteggio), 1), count(*)::integer
    from evaluations e
    where e.athlete_id = p_athlete_id
      and e.data_valutazione >= now() - interval '120 days'
    group by e.fondamentale
    order by avg(e.punteggio) asc
    limit greatest(1, p_quante);
end;
$$;

create or replace function verifica_formazione(p_set_id uuid)
returns table(avviso text, gravita text)
language plpgsql stable security definer set search_path = public
as $$
declare v_team_id uuid; v_match_id uuid;
begin
  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  return query
  select
    format('%s è indicato come Libero ma si trova in posizione %s: il Libero gioca solo in seconda linea (5, 6, 1) e non può servire.',
           a.cognome, l.posizione),
    'attenzione'
  from match_set_lineups l
  join athletes a on a.id = l.athlete_id
  join match_convocati c on c.match_id = v_match_id and c.athlete_id = l.athlete_id
  where l.set_id = p_set_id and l.in_campo = true and c.is_libero = true
    and l.posizione in (1, 2, 3, 4);
end;
$$;

create or replace function cambia_ruolo_membro(p_team_id uuid, p_user_id uuid, p_nuovo_ruolo text, p_atleta_id uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ruolo_attuale text;
  v_altri_allenatori integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;
  if p_nuovo_ruolo not in ('allenatore','vice_allenatore','presidente','atleta') then
    raise exception 'Profilo non valido';
  end if;

  select ruolo into v_ruolo_attuale from team_members where team_id = p_team_id and user_id = p_user_id;
  if v_ruolo_attuale is null then raise exception 'Questa persona non fa parte della squadra'; end if;

  if v_ruolo_attuale = 'allenatore' and p_nuovo_ruolo <> 'allenatore' then
    select count(*) into v_altri_allenatori from team_members
    where team_id = p_team_id and ruolo = 'allenatore' and user_id <> p_user_id;
    if v_altri_allenatori = 0 then
      raise exception 'Non puoi togliere l''ultimo allenatore della squadra: nominane prima un altro';
    end if;
  end if;

  if p_nuovo_ruolo = 'atleta' then
    if p_atleta_id is null then raise exception 'Per il profilo atleta indica a quale scheda collegarlo'; end if;
    if not exists (select 1 from athletes where id = p_atleta_id and team_id = p_team_id) then
      raise exception 'Scheda non trovata in questa squadra';
    end if;
    if exists (select 1 from team_members where atleta_id = p_atleta_id and user_id <> p_user_id) then
      raise exception 'Questa scheda è già collegata a un altro account';
    end if;
  end if;

  update team_members
  set ruolo = p_nuovo_ruolo,
      atleta_id = case when p_nuovo_ruolo = 'atleta' then p_atleta_id else null end
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;
