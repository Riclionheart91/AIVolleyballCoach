-- ============================================================
-- 0014 — Fix: preparazione e avvio dei set successivi al primo
--
-- BUG: avvia_preparazione_match() e avvia_match_confermato()
-- cercavano entrambe il set con "numero_set = 1" FISSO. Dopo la
-- chiusura del primo set, nuovo_set() creava correttamente il set 2,
-- ma la schermata di preparazione chiamava avvia_preparazione_match()
-- che le restituiva comunque l'id del SET 1 — già avviato e con la
-- sua formazione. Risultato: l'app tornava a chiedere convocati e
-- formazione del primo set e la partita non proseguiva mai oltre.
--
-- Corretto: entrambe lavorano sul set CORRENTE, cioè l'ultimo non
-- ancora concluso (o il set 1, creandolo, se la partita non ne ha
-- ancora nessuno).
-- ============================================================

create or replace function avvia_preparazione_match(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_set_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  -- Set corrente = l'ultimo non concluso (non più "il numero 1").
  select id into v_set_id
  from match_sets
  where match_id = p_match_id and concluso = false
  order by numero_set desc
  limit 1;

  -- Nessun set aperto: se la partita non ne ha proprio (prima
  -- preparazione) si crea il numero 1; se invece ne ha già di
  -- conclusi, si crea il successivo.
  if v_set_id is null then
    insert into match_sets (match_id, numero_set)
    values (p_match_id, (select coalesce(max(numero_set), 0) + 1 from match_sets where match_id = p_match_id))
    returning id into v_set_id;
  end if;

  return v_set_id;
end;
$$;

create or replace function avvia_match_confermato(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_set_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  -- Anche qui: il set da verificare è quello corrente, non il primo.
  select id into v_set_id
  from match_sets
  where match_id = p_match_id and concluso = false
  order by numero_set desc
  limit 1;

  if v_set_id is null or not exists (select 1 from match_set_lineups where set_id = v_set_id) then
    raise exception 'Imposta prima convocati e formazione iniziale';
  end if;

  update matches set stato = 'in_corso' where id = p_match_id;
end;
$$;

-- I set vinti erano aggiornati SOLO da chiudi_match(), quindi durante
-- la partita restavano a 0 e il client non poteva sapere quando si
-- era raggiunto il 3-0/3-1/3-2. Questa funzione li calcola dal vivo
-- dai set già conclusi.
create or replace function conteggio_set_vinti(p_match_id uuid)
returns table(set_vinti_noi integer, set_vinti_avversario integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    count(*) filter (where punti_noi > punti_avversario)::integer,
    count(*) filter (where punti_avversario > punti_noi)::integer
  from match_sets
  where match_id = p_match_id and concluso = true;
$$;

revoke execute on function conteggio_set_vinti(uuid) from anon;
grant execute on function conteggio_set_vinti(uuid) to authenticated;
