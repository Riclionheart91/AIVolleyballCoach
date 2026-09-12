-- ============================================================
-- 0015 — Ciclo di valutazione mensile
--
-- Roadmap punto 4: invece del flusso ad-hoc ("valuti quando ti
-- ricordi"), un ciclo con cadenza configurabile che dice sempre CHI è
-- da valutare adesso.
--
-- Come per la pianificazione annuale e il centro notifiche, il
-- promemoria è REATTIVO: calcolato quando apri l'app, non inviato da
-- un cron in background (servirebbe infrastruttura server che questo
-- stack non ha). Il risultato pratico è lo stesso — apri l'app e vedi
-- chi manca — senza però una notifica push a telefono spento.
-- ============================================================

-- Cadenza configurabile per squadra: 30 giorni di default (mensile),
-- ma una squadra giovanile potrebbe volerla ogni 45/60 giorni.
alter table teams add column if not exists giorni_ciclo_valutazione integer not null default 30;

/**
 * Atlete da valutare: quelle senza nessuna valutazione, o la cui
 * valutazione più recente è più vecchia della cadenza impostata.
 * "giorni_dall_ultima" è null per chi non è mai stata valutata.
 */
create or replace function atlete_da_valutare(p_team_id uuid)
returns table(
  athlete_id uuid,
  nome text,
  cognome text,
  numero_maglia integer,
  ultima_valutazione date,
  giorni_dall_ultima integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_giorni integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  -- Solo lo staff con visione piena vede l'elenco nominativo di chi è
  -- indietro con le valutazioni: un'atleta non deve sapere lo stato
  -- delle compagne (stessa regola di privacy già applicata altrove).
  if not is_team_staff_visione_piena(p_team_id) then raise exception 'Permesso negato'; end if;

  select coalesce(t.giorni_ciclo_valutazione, 30) into v_giorni from teams t where t.id = p_team_id;

  return query
    select
      a.id,
      a.nome,
      a.cognome,
      a.numero_maglia,
      max(e.data_valutazione)::date,
      case when max(e.data_valutazione) is null then null
           else (current_date - max(e.data_valutazione)::date)::integer end
    from athletes a
    left join evaluations e on e.athlete_id = a.id
    where a.team_id = p_team_id and a.status = 'attiva'
    group by a.id, a.nome, a.cognome, a.numero_maglia
    having max(e.data_valutazione) is null
        or (current_date - max(e.data_valutazione)::date) >= v_giorni
    order by max(e.data_valutazione) asc nulls first;
end;
$$;

create or replace function imposta_cadenza_valutazione(p_team_id uuid, p_giorni integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;
  if p_giorni < 7 or p_giorni > 365 then raise exception 'La cadenza deve essere tra 7 e 365 giorni'; end if;

  update teams set giorni_ciclo_valutazione = p_giorni where id = p_team_id;
end;
$$;

revoke execute on function atlete_da_valutare(uuid) from anon;
revoke execute on function imposta_cadenza_valutazione(uuid, integer) from anon;
grant execute on function atlete_da_valutare(uuid) to authenticated;
grant execute on function imposta_cadenza_valutazione(uuid, integer) to authenticated;
