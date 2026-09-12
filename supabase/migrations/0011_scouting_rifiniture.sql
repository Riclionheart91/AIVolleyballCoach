-- ============================================================
-- 0011 — Rifiniture scouting: servizio per set, blocco dopo l'avvio
--
-- "squadra_al_servizio" cambia continuamente durante il set (ad ogni
-- side-out) — non basta per sapere chi ha servito PER PRIMO in quel
-- set, informazione che serve per applicare la regola "l'ordine di
-- servizio si alterna automaticamente tra un set e l'altro, tranne al
-- 5° set dove si richiede di nuovo la scelta" (Art. 12, si veda
-- REGOLE_PALLAVOLO.md). Aggiunta una colonna separata, immutabile una
-- volta che il set ha già eventi registrati.
-- ============================================================

alter table match_sets add column if not exists chi_ha_servito_per_primo text check (chi_ha_servito_per_primo in ('noi', 'avversario'));

create or replace function imposta_formazione_iniziale(p_set_id uuid, p_posizioni jsonb, p_chi_serve text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_pos integer;
  v_athlete_id uuid;
begin
  select m.id, m.team_id into v_match_id, v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;
  if p_chi_serve not in ('noi', 'avversario') then raise exception 'Indica chi serve per prima (noi/avversario)'; end if;
  if p_posizioni is null or p_posizioni = '{}'::jsonb then raise exception 'Formazione vuota'; end if;

  -- Una volta che il set ha già eventi registrati, la scelta di chi
  -- serve per prima non è più modificabile (Art. 7.3: la formazione e
  -- l'ordine di servizio si dichiarano prima dell'inizio del set, non
  -- durante).
  if exists (select 1 from match_events where set_id = p_set_id) then
    raise exception 'Questo set ha già eventi registrati: la scelta di chi serve non è più modificabile';
  end if;

  for v_pos in 1..6
  loop
    if not (p_posizioni ? v_pos::text) then
      raise exception 'Manca la posizione % nella formazione', v_pos;
    end if;
    v_athlete_id := (p_posizioni->>v_pos::text)::uuid;
    if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = v_athlete_id) then
      raise exception 'Una delle giocatrici in formazione non è tra le convocate per questa partita';
    end if;
  end loop;

  delete from match_set_lineups where set_id = p_set_id;
  for v_pos in 1..6
  loop
    insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
    values (p_set_id, (p_posizioni->>v_pos::text)::uuid, true, v_pos);
  end loop;

  update match_sets set squadra_al_servizio = p_chi_serve, chi_ha_servito_per_primo = p_chi_serve where id = p_set_id;
end;
$$;

-- Determina in automatico chi deve servire per prima in un nuovo set,
-- secondo la regola "si alterna rispetto al set precedente" — tranne
-- quando il nuovo set è il 5° (decisivo), dove va richiesto di nuovo
-- (torna null: il client lo interpreta come "chiedi all'utente").
create or replace function chi_serve_default_nuovo_set(p_match_id uuid, p_numero_nuovo_set integer)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_precedente text;
begin
  if p_numero_nuovo_set = 1 or p_numero_nuovo_set = 5 then
    return null; -- 1° set: nessun precedente da alternare. 5° set: si richiede una nuova scelta per regolamento.
  end if;

  select chi_ha_servito_per_primo into v_precedente
  from match_sets where match_id = p_match_id and numero_set = p_numero_nuovo_set - 1;

  if v_precedente is null then return null; end if;
  return case when v_precedente = 'noi' then 'avversario' else 'noi' end;
end;
$$;

revoke execute on function chi_serve_default_nuovo_set(uuid, integer) from anon;
grant execute on function chi_serve_default_nuovo_set(uuid, integer) to authenticated;
