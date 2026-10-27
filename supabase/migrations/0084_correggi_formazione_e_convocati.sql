-- 0084 — Correggere la formazione a partita iniziata, aggiungere convocati/Libero in corsa, azzerare la partita.
-- Regole: azzerare la partita e aggiungere convocati (non Libero) solo durante il primo set;
-- correggere la formazione e aggiungere un Libero per tutta la partita.
--
-- correggi_formazione: rimette in campo le 6 persone indicate nelle posizioni indicate (e, se richiesto,
--   cambia chi sta battendo) SENZA toccare punti e azioni gia' registrati. Chi viene tolto dal campo
--   per correzione NON conta come sostituzione e puo' rientrare con un cambio normale.
--   Possono farlo staff tecnico, superuser e scout ospite della partita in corso.
-- aggiungi_convocato: aggiunge alla distinta della partita una persona dimenticata, anche come Libero
--   (o segna Libero una convocata che non lo era). Rispetta i limiti del campionato. Solo staff.
-- ricomincia_partita: riporta una partita IN CORSO a "da preparare" come appena sincronizzata: cancella set, punti,
--   azioni, formazioni, time-out, cambi del Libero, convocati e scelta del Libero. Restano la partita (data, avversario,
--   collegamento con SportEasy, campionato) e il QR degli scout. Solo staff tecnico e superuser.
create or replace function ricomincia_partita(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id, stato into v_team_id, v_stato from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if v_stato <> 'in_corso' then raise exception 'Si può azzerare solo una partita in corso'; end if;
  if exists (select 1 from match_sets where match_id = p_match_id and (numero_set > 1 or concluso)) then
    raise exception 'Si può azzerare la partita solo durante il primo set';
  end if;

  -- I set portano con sé azioni, formazioni, time-out e cambi del Libero (cancellazione a cascata).
  delete from match_sets where match_id = p_match_id;
  delete from match_events where match_id = p_match_id;
  delete from match_timeouts where match_id = p_match_id;
  delete from match_convocati where match_id = p_match_id;
  delete from match_libero_regola where match_id = p_match_id;
  delete from scout_turno_partita where match_id = p_match_id;

  update matches set stato = 'programmata', set_vinti_noi = 0, set_vinti_avversario = 0 where id = p_match_id;
end;
$$;

create or replace function correggi_formazione(p_set_id uuid, p_posizioni jsonb, p_chi_serve text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_team_id uuid;
  v_stato text;
  v_concluso boolean;
  v_chiave text;
  v_athlete uuid;
  v_ids uuid[] := array[]::uuid[];
  v_ha_eventi boolean;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.id, m.team_id, m.stato, ms.concluso into v_match_id, v_team_id, v_stato, v_concluso
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not (is_team_coach(v_team_id) or is_superuser() or is_scout_ospite(v_match_id)) then raise exception 'Permesso negato'; end if;
  if v_stato <> 'in_corso' or v_concluso then raise exception 'La formazione si corregge solo nel set in corso di una partita in corso'; end if;
  if p_chi_serve is not null and p_chi_serve not in ('noi', 'avversario') then raise exception 'Valore non valido per chi serve'; end if;

  for v_chiave in select jsonb_object_keys(p_posizioni) loop
    if v_chiave !~ '^[1-6]$' then raise exception 'Posizione non valida: %', v_chiave; end if;
    v_athlete := (p_posizioni ->> v_chiave)::uuid;
    if v_athlete = any(v_ids) then raise exception 'La stessa persona è indicata in due posizioni'; end if;
    if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = v_athlete and not is_libero) then
      raise exception 'Una delle persone indicate non è tra i convocati (o è un Libero)';
    end if;
    v_ids := v_ids || v_athlete;
  end loop;
  if coalesce(array_length(v_ids, 1), 0) <> 6 then raise exception 'Servono esattamente 6 posizioni, ne sono arrivate %', coalesce(array_length(v_ids, 1), 0); end if;

  if exists (
    select 1 from match_set_lineups l join match_convocati c on c.match_id = v_match_id and c.athlete_id = l.athlete_id
    where l.set_id = p_set_id and l.in_campo and c.is_libero
  ) then
    raise exception 'Il Libero è in campo: fallo prima uscire, poi correggi la formazione';
  end if;

  v_ha_eventi := exists (select 1 from match_events where set_id = p_set_id);

  -- Chi esce per correzione non e' un cambio: la sua riga sparisce (se non ha gia' giocato altrove nel set puo' rientrare con un cambio normale).
  delete from match_set_lineups where set_id = p_set_id and in_campo and not (athlete_id = any(v_ids));
  -- Si liberano tutte le posizioni prima di riassegnarle (indice univoco su set + posizione).
  update match_set_lineups set posizione = null where set_id = p_set_id and in_campo and posizione is not null;

  for v_chiave in select jsonb_object_keys(p_posizioni) loop
    v_athlete := (p_posizioni ->> v_chiave)::uuid;
    insert into match_set_lineups (set_id, athlete_id, in_campo, posizione, posizione_iniziale)
    values (p_set_id, v_athlete, true, v_chiave::integer, case when v_ha_eventi then null else v_chiave::integer end)
    on conflict (set_id, athlete_id) do update set
      in_campo = true,
      posizione = excluded.posizione,
      posizione_iniziale = case when v_ha_eventi then match_set_lineups.posizione_iniziale else excluded.posizione end,
      aggiornato_il = now();
  end loop;

  if not v_ha_eventi then delete from rimpiazzi_libero where set_id = p_set_id; end if;

  if p_chi_serve is not null then
    update match_sets set
      squadra_al_servizio = p_chi_serve,
      chi_ha_servito_per_primo = case when v_ha_eventi then chi_ha_servito_per_primo else p_chi_serve end
    where id = p_set_id;
  end if;
end;
$$;

create or replace function aggiungi_convocato(p_match_id uuid, p_athlete_id uuid, p_is_libero boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato text;
  v_camp record;
  v_max_liberi integer := 2;
  v_max_distinta integer;
  v_esiste boolean;
  v_gia_libero boolean;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id, stato into v_team_id, v_stato from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if v_stato = 'conclusa' then raise exception 'La partita è conclusa'; end if;
  -- Il Libero si puo' aggiungere per tutta la partita; i convocati solo durante il primo set.
  if not coalesce(p_is_libero, false) and exists (select 1 from match_sets where match_id = p_match_id and (numero_set > 1 or concluso)) then
    raise exception 'I convocati si possono cambiare solo durante il primo set (il Libero si può aggiungere sempre)';
  end if;
  if not exists (select 1 from athletes where id = p_athlete_id and team_id = v_team_id) then
    raise exception 'La persona non appartiene a questa squadra';
  end if;

  select c.* into v_camp from matches m join campionati c on c.id = m.campionato_id where m.id = p_match_id;
  if found then v_max_liberi := v_camp.numero_liberi_max; v_max_distinta := v_camp.distinta_max_giocatrici; end if;

  select is_libero into v_gia_libero from match_convocati where match_id = p_match_id and athlete_id = p_athlete_id;
  v_esiste := found;

  if not v_esiste and v_max_distinta is not null then
    if (select count(*) from match_convocati where match_id = p_match_id) >= v_max_distinta then
      raise exception 'La distinta ha già il massimo di % giocatrici per questo campionato', v_max_distinta;
    end if;
  end if;

  if p_is_libero and not coalesce(v_gia_libero, false) then
    if exists (
      select 1 from match_set_lineups l join match_sets s on s.id = l.set_id
      where s.match_id = p_match_id and l.athlete_id = p_athlete_id and l.in_campo
    ) then
      raise exception 'Questa persona è in campo: falla prima uscire per farla diventare Libero';
    end if;
    if (select count(*) from match_convocati where match_id = p_match_id and is_libero) >= v_max_liberi then
      raise exception 'Massimo % Libero per questa partita', v_max_liberi;
    end if;
  end if;

  insert into match_convocati (match_id, athlete_id, is_libero)
  values (p_match_id, p_athlete_id, coalesce(p_is_libero, false))
  on conflict (match_id, athlete_id) do update set is_libero = match_convocati.is_libero or excluded.is_libero;
end;
$$;

revoke execute on function correggi_formazione(uuid, jsonb, text) from public, anon;
revoke execute on function aggiungi_convocato(uuid, uuid, boolean) from public, anon;
grant execute on function correggi_formazione(uuid, jsonb, text) to authenticated;
grant execute on function aggiungi_convocato(uuid, uuid, boolean) to authenticated;
revoke execute on function ricomincia_partita(uuid) from public, anon;
grant execute on function ricomincia_partita(uuid) to authenticated;
