-- 0094: messaggi di errore delle funzioni di formazione e convocazioni senza forme solo femminili.
--
-- Solo i testi delle eccezioni cambiano (e un commento): logica, firme e permessi restano identici.
-- Le funzioni sono ridefinite con CREATE OR REPLACE a partire dalla definizione presente nel database
-- (aggiungi_convocato, imposta_convocati, imposta_formazione_set, cambia_giocatore), quindi i privilegi
-- esistenti non cambiano.
-- NON ancora applicata: da applicare a mano dopo la 0093.

-- 1. aggiungi_convocato -------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.aggiungi_convocato(p_match_id uuid, p_athlete_id uuid, p_is_libero boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_team_id uuid; v_stato text; v_camp record; v_max_liberi integer := 2; v_max_distinta integer; v_esiste boolean; v_gia_libero boolean; begin if auth.uid() is null then raise exception 'Utente non autenticato'; end if; select team_id, stato into v_team_id, v_stato from matches where id = p_match_id; if v_team_id is null then raise exception 'Partita non trovata'; end if; if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if; if v_stato = 'conclusa' then raise exception 'La partita è conclusa'; end if; if not coalesce(p_is_libero, false) and exists (select 1 from match_sets where match_id = p_match_id and (numero_set > 1 or concluso)) then raise exception 'I convocati si possono cambiare solo durante il primo set (il Libero si può aggiungere sempre)'; end if; if not exists (select 1 from athletes where id = p_athlete_id and team_id = v_team_id) then raise exception 'La persona non appartiene a questa squadra'; end if; select c.* into v_camp from matches m join campionati c on c.id = m.campionato_id where m.id = p_match_id; if found then v_max_liberi := v_camp.numero_liberi_max; v_max_distinta := v_camp.distinta_max_giocatrici; end if; select is_libero into v_gia_libero from match_convocati where match_id = p_match_id and athlete_id = p_athlete_id; v_esiste := found; if not v_esiste and v_max_distinta is not null then if (select count(*) from match_convocati where match_id = p_match_id) >= v_max_distinta then raise exception 'La distinta ha già il massimo di % atleti per questo campionato', v_max_distinta; end if; end if; if p_is_libero and not coalesce(v_gia_libero, false) then if exists ( select 1 from match_set_lineups l join match_sets s on s.id = l.set_id where s.match_id = p_match_id and l.athlete_id = p_athlete_id and l.in_campo ) then raise exception 'Chi è in campo deve prima uscire per poter diventare Libero'; end if; if (select count(*) from match_convocati where match_id = p_match_id and is_libero) >= v_max_liberi then raise exception 'Massimo % Libero per questa partita', v_max_liberi; end if; end if; insert into match_convocati (match_id, athlete_id, is_libero) values (p_match_id, p_athlete_id, coalesce(p_is_libero, false)) on conflict (match_id, athlete_id) do update set is_libero = match_convocati.is_libero or excluded.is_libero; end; $function$;

-- 2. imposta_convocati --------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.imposta_convocati(p_match_id uuid, p_athlete_ids uuid[], p_libero_ids uuid[] DEFAULT ARRAY[]::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id uuid;
  v_campionato record;
  v_athlete_id uuid;
begin
  select team_id, campionato_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  if array_length(p_athlete_ids, 1) is null or array_length(p_athlete_ids, 1) < 1 then
    raise exception 'Serve almeno un convocato';
  end if;

  -- Se la partita è legata a un campionato con regole di distinta
  -- configurate, verifica i limiti (min/max atleti, max Libero) —
  -- altrimenti (amichevole senza campionato) nessun vincolo numerico.
  select c.* into v_campionato from matches m join campionati c on c.id = m.campionato_id where m.id = p_match_id;
  if found then
    if array_length(p_athlete_ids, 1) < v_campionato.distinta_min_giocatrici or array_length(p_athlete_ids, 1) > v_campionato.distinta_max_giocatrici then
      raise exception 'La distinta deve avere tra % e % atleti per questo campionato (indicati: %)', v_campionato.distinta_min_giocatrici, v_campionato.distinta_max_giocatrici, array_length(p_athlete_ids, 1);
    end if;
    if array_length(p_libero_ids, 1) is not null and array_length(p_libero_ids, 1) > v_campionato.numero_liberi_max then
      raise exception 'Massimo % Libero per questo campionato', v_campionato.numero_liberi_max;
    end if;
  end if;

  foreach v_athlete_id in array p_athlete_ids
  loop
    if not exists (select 1 from athletes where id = v_athlete_id and team_id = v_team_id) then
      raise exception 'Uno dei convocati non appartiene a questa squadra';
    end if;
  end loop;

  delete from match_convocati where match_id = p_match_id;
  foreach v_athlete_id in array p_athlete_ids
  loop
    insert into match_convocati (match_id, athlete_id, is_libero) values (p_match_id, v_athlete_id, v_athlete_id = any(p_libero_ids));
  end loop;
end;
$function$;

-- 3. imposta_formazione_set ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.imposta_formazione_set(p_set_id uuid, p_athlete_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_team_id uuid;
  v_athlete_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select m.team_id into v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  foreach v_athlete_id in array p_athlete_ids
  loop
    if not exists (select 1 from athletes where id = v_athlete_id and team_id = v_team_id) then
      raise exception 'Uno degli atleti indicati non appartiene a questa squadra';
    end if;
  end loop;

  delete from match_set_lineups where set_id = p_set_id;

  foreach v_athlete_id in array p_athlete_ids
  loop
    insert into match_set_lineups (set_id, athlete_id, in_campo) values (p_set_id, v_athlete_id, true);
  end loop;
end;
$function$;

-- 4. cambia_giocatore ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cambia_giocatore(p_set_id uuid, p_atleta_uscente uuid, p_atleta_entrante uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_team_id uuid; v_match_id uuid; v_posizione integer; v_sostituisce uuid; v_uscente_titolare boolean; v_uscente_rientrato boolean; v_riga_entrante record; v_rientro boolean := false; begin select m.id, m.team_id into v_match_id, v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id; if v_team_id is null then raise exception 'Set non trovato'; end if; if not (is_team_scout(v_team_id) or is_scout_ospite_set(p_set_id)) then raise exception 'Permesso negato'; end if; select posizione, sostituisce_id, (posizione_iniziale is not null), rientrato into v_posizione, v_sostituisce, v_uscente_titolare, v_uscente_rientrato from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_uscente and in_campo = true; if v_posizione is null then raise exception 'Chi deve uscire non risulta in campo in questo set'; end if; if v_uscente_rientrato then raise exception 'Chi è rientrato dopo un cambio non può più uscire in questo set (regolamento). Per correggere un errore usa Formazione'; end if; if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_atleta_entrante) then raise exception 'Chi deve entrare non è tra i convocati di questa partita'; end if; if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = true) then raise exception 'Chi deve entrare è già in campo'; end if; select * into v_riga_entrante from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante; if v_sostituisce is not null and v_sostituisce <> p_atleta_entrante then raise exception 'Chi è entrato al posto di un atleta titolare può uscire solo per quell''atleta (regolamento): al suo posto può rientrare solo chi aveva sostituito'; end if; if v_riga_entrante.id is not null then if v_riga_entrante.posizione_iniziale is null then raise exception 'Chi deve entrare è già uscito in questo set e non può rientrare'; end if; if v_riga_entrante.rientrato then raise exception 'Chi deve entrare è già rientrato una volta in questo set e non può rientrare ancora'; end if; if v_sostituisce is null then if v_uscente_titolare or exists ( select 1 from match_set_lineups where set_id = p_set_id and in_campo = true and sostituisce_id = p_atleta_entrante ) then raise exception 'Chi deve entrare è già uscito in questo set e può rientrare solo al posto di chi lo ha sostituito'; end if; end if; v_rientro := true; end if; update match_set_lineups set in_campo = false, posizione = null where set_id = p_set_id and athlete_id = p_atleta_uscente; if v_rientro then update match_set_lineups set in_campo = true, posizione = v_posizione, sostituisce_id = null, rientrato = true, aggiornato_il = now() where set_id = p_set_id and athlete_id = p_atleta_entrante; else insert into match_set_lineups (set_id, athlete_id, in_campo, posizione, sostituisce_id) values (p_set_id, p_atleta_entrante, true, v_posizione, p_atleta_uscente) on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione, sostituisce_id = p_atleta_uscente; end if; update match_libero_regola set titolare_1 = case when titolare_1 = p_atleta_uscente then p_atleta_entrante else titolare_1 end, titolare_2 = case when titolare_2 = p_atleta_uscente then p_atleta_entrante else titolare_2 end, aggiornato_il = now() where match_id = v_match_id and p_atleta_uscente in (titolare_1, titolare_2); end; $function$;
