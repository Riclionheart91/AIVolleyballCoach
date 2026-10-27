-- 0085 — Limiti d'uso: azzerare la partita e aggiungere un convocato (non Libero) solo durante il primo set.
-- Correggere la formazione e aggiungere un Libero restano possibili per tutta la partita.
-- (Aggiorna le definizioni gia' presenti dalla 0084.)
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
