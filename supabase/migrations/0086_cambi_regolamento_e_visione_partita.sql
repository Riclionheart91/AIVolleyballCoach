-- 0086 — Cambi secondo regolamento e visione della partita senza essere scout.
--
-- 1) Cambi: chi entra al posto di una titolare deve poter uscire solo per lei (e lei puo' rientrare solo al
--    suo posto, una volta per set). Per farlo si registra, su chi entra, chi ha sostituito (sostituisce_id);
--    quando la titolare rientra si segna rientrato = true (non puo' rientrare una seconda volta).
-- 2) Visione: chi non e' scout (membri della squadra, superuser non iscritto alla squadra) deve poter leggere
--    set, Libero in campo e regola del Libero, altrimenti la partita resta su "Caricamento set..." o mostra
--    la titolare al posto del Libero.

alter table match_set_lineups add column if not exists sostituisce_id uuid references athletes(id) on delete set null;
alter table match_set_lineups add column if not exists rientrato boolean not null default false;

create or replace function cambia_giocatore(p_set_id uuid, p_atleta_uscente uuid, p_atleta_entrante uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
  v_sostituisce uuid;
  v_uscente_titolare boolean;
  v_riga_entrante record;
  v_rientro boolean := false;
begin
  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not (is_team_scout(v_team_id) or is_scout_ospite_set(p_set_id)) then raise exception 'Permesso negato'; end if;

  select posizione, sostituisce_id, (posizione_iniziale is not null) into v_posizione, v_sostituisce, v_uscente_titolare
  from match_set_lineups
  where set_id = p_set_id and athlete_id = p_atleta_uscente and in_campo = true;
  if v_posizione is null then raise exception 'Chi deve uscire non risulta in campo in questo set'; end if;

  if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_atleta_entrante) then
    raise exception 'Chi deve entrare non è tra i convocati di questa partita';
  end if;
  if exists (select 1 from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante and in_campo = true) then
    raise exception 'Chi deve entrare è già in campo';
  end if;

  select * into v_riga_entrante from match_set_lineups where set_id = p_set_id and athlete_id = p_atleta_entrante;

  -- Chi e' entrato al posto di una titolare puo' essere sostituito solo da lei.
  if v_sostituisce is not null and v_sostituisce <> p_atleta_entrante then
    raise exception 'Chi è entrato al posto di una titolare può uscire solo per lei (regolamento): al suo posto può rientrare solo chi aveva sostituito';
  end if;

  if v_riga_entrante.id is not null then
    -- E' gia' uscita in questo set: puo' solo rientrare, una volta, al posto di chi l'ha sostituita.
    if v_riga_entrante.posizione_iniziale is null then
      raise exception 'Chi deve entrare è già uscito in questo set e non può rientrare';
    end if;
    if v_riga_entrante.rientrato then
      raise exception 'Chi deve entrare è già rientrato una volta in questo set e non può rientrare ancora';
    end if;
    if v_sostituisce is null then
      -- Cambi registrati prima di questa regola (non sappiamo chi ha sostituito chi): rientra solo se nessun altro
      -- in campo risulta averla sostituita e chi esce non e' una titolare.
      if v_uscente_titolare or exists (
        select 1 from match_set_lineups where set_id = p_set_id and in_campo = true and sostituisce_id = p_atleta_entrante
      ) then
        raise exception 'Chi deve entrare è già uscito in questo set e può rientrare solo al posto di chi l''ha sostituita';
      end if;
    end if;
    v_rientro := true;
  else
    -- Panchina mai entrata: un'altra giocatrice e' in campo al posto di una titolare uscita? Nessun vincolo ulteriore.
    null;
  end if;

  update match_set_lineups set in_campo = false, posizione = null
  where set_id = p_set_id and athlete_id = p_atleta_uscente;

  if v_rientro then
    update match_set_lineups
    set in_campo = true, posizione = v_posizione, sostituisce_id = null, rientrato = true, aggiornato_il = now()
    where set_id = p_set_id and athlete_id = p_atleta_entrante;
  else
    insert into match_set_lineups (set_id, athlete_id, in_campo, posizione, sostituisce_id)
    values (p_set_id, p_atleta_entrante, true, v_posizione, p_atleta_uscente)
    on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione, sostituisce_id = p_atleta_uscente;
  end if;

  -- Se usciva un centrale associato al Libero, l'associazione passa a chi entra.
  update match_libero_regola
  set titolare_1 = case when titolare_1 = p_atleta_uscente then p_atleta_entrante else titolare_1 end,
      titolare_2 = case when titolare_2 = p_atleta_uscente then p_atleta_entrante else titolare_2 end,
      aggiornato_il = now()
  where match_id = v_match_id and p_atleta_uscente in (titolare_1, titolare_2);
end;
$function$;

-- Visione: tutti i membri della squadra (e il superuser) leggono i set; prima la regola era solo per i membri.
alter policy "match_sets_select_unificata" on match_sets using (
  is_team_member((select matches.team_id from matches where matches.id = match_sets.match_id)) or is_superuser()
);

alter policy "rimpiazzi_libero_select" on rimpiazzi_libero using (
  is_team_member((select m.team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = rimpiazzi_libero.set_id))
  or is_superuser()
);

create or replace function libero_in_campo(p_set_id uuid)
returns table(libero_id uuid, titolare_id uuid, posizione integer)
language sql stable security definer set search_path to 'public'
as $function$
  select r.libero_id, r.titolare_id, l.posizione
  from rimpiazzi_libero r
  left join match_set_lineups l on l.set_id = r.set_id and l.athlete_id = r.libero_id and l.in_campo = true
  where r.set_id = p_set_id and r.uscito_il is null
    and (
      is_team_member((select m.team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id))
      or is_superuser()
      or is_scout_ospite_set(p_set_id)
    )
  limit 1;
$function$;

create or replace function leggi_regola_libero(p_match_id uuid)
returns table(libero_id uuid, titolare_1 uuid, titolare_2 uuid)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_member(v_team_id) or is_superuser() or is_scout_ospite(p_match_id)) then raise exception 'Permesso negato'; end if;
  return query select r.libero_id, r.titolare_1, r.titolare_2 from match_libero_regola r where r.match_id = p_match_id;
end;
$function$;
