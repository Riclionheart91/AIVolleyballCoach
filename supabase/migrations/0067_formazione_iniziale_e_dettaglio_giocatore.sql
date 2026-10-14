-- Due aggiunte indipendenti, raccolte in un'unica migration.
--
-- A) Formazione INIZIALE del set, conservata.
--    Durante il set le posizioni ruotano e vengono sovrascritte, quindi a
--    fine set la formazione di partenza non era più ricavabile. Serve per
--    proporre "stessa formazione del set precedente" all'inizio del set
--    successivo. Si memorizza la posizione dichiarata alla partenza in una
--    colonna che nessuna rotazione o cambio tocca (quelle aggiornano solo
--    "posizione"). I set già giocati prima di questa migration restano
--    senza dato: per loro la funzione non è disponibile.
--
-- B) Statistiche per giocatore con il dettaglio per fondamentale
--    (azioni, punti, neutri, errori e qualità delle ricezioni), per la
--    riga espandibile nell'analisi partita. Stessa regola di visibilità di
--    analisi_persone_partita: lo staff e chi scouta vedono tutti, chi
--    gioca vede solo le proprie righe.

alter table match_set_lineups add column if not exists posizione_iniziale integer;

create or replace function imposta_formazione_iniziale(p_set_id uuid, p_posizioni jsonb, p_chi_serve text default 'noi')
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

    insert into match_set_lineups (set_id, athlete_id, posizione, posizione_iniziale, in_campo)
    values (p_set_id, v_athlete, v_chiave::integer, v_chiave::integer, true);
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
$function$;

create or replace function analisi_persone_dettaglio_partita(p_match_id uuid)
returns table(
  athlete_id uuid,
  fondamentale text,
  azioni integer,
  punti integer,
  neutri integer,
  errori integer,
  ricezioni_ottime integer,
  ricezioni_buone integer,
  ricezioni_scarse integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_mio uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  v_mio := mio_atleta_id(v_team_id);
  if not (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id) or v_mio is not null) then
    raise exception 'Permesso negato';
  end if;

  return query
  select
    me.athlete_id,
    me.skill,
    count(*)::integer,
    (count(*) filter (where me.esito = 'punto'))::integer,
    (count(*) filter (where me.esito = 'neutro'))::integer,
    (count(*) filter (where me.esito = 'errore'))::integer,
    (count(*) filter (where me.skill = 'Ricezione' and me.qualita = 'ottima'))::integer,
    (count(*) filter (where me.skill = 'Ricezione' and me.qualita = 'buona'))::integer,
    (count(*) filter (where me.skill = 'Ricezione' and me.qualita = 'scarsa'))::integer
  from match_events me
  where me.match_id = p_match_id
    and me.athlete_id is not null
    and (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id) or me.athlete_id = v_mio)
  group by me.athlete_id, me.skill
  order by me.athlete_id, count(*) desc;
end;
$function$;

revoke execute on function analisi_persone_dettaglio_partita(uuid) from public;
revoke execute on function analisi_persone_dettaglio_partita(uuid) from anon;
grant execute on function analisi_persone_dettaglio_partita(uuid) to authenticated;
