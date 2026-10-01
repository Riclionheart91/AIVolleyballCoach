-- Qualità ricezione + side-out% / break-point%, dal confronto con gli
-- standard di scouting pallavolistico professionale (DataVolley/VolleyStation):
--
-- 1) La ricezione oggi ha solo "neutro"/"errore" (non può mai essere
--    "punto" con le regole standard). Aggiungiamo una qualità opzionale
--    sul "neutro" (ottima/buona/scarsa) che ricalca la scala standard
--    di scouting (es. "3-2-1-0" di Coleman): dice quante opzioni
--    d'attacco restano dopo la ricezione, non solo che il punto non è
--    stato perso. Non tocca la semantica di punteggio/rotazione — tutti
--    e quattro i trigger su match_events referenziano solo colonne per
--    nome (skill/esito/set_id/servizio_precedente/rotazione_applicata/
--    rotazione_al_servizio/turno_servizio: verificato via
--    pg_get_functiondef prima di questa migrazione), quindi una nuova
--    colonna nullable è sicura.
--
-- 2) Side-out% (punti vinti ricevendo) e break-point% (punti vinti
--    servendo) sono le due metriche-cardine dell'analisi pallavolistica
--    professionale, assenti oggi dall'app pur avendo già tutto il dato
--    necessario in match_events.servizio_precedente. Stessa convenzione
--    vinco/perdo già usata in rendimento_turni_servizio e nel trigger
--    di punteggio: "vinciamo" = esito='punto' OR skill='Punto_nostro'.

alter table match_events
  add column qualita text check (qualita in ('ottima', 'buona', 'scarsa'));

comment on column match_events.qualita is
  'Qualità opzionale della ricezione (solo skill=Ricezione, esito=neutro): ottima/buona/scarsa, scala di scouting standard. Null per tutti gli altri fondamentali e per gli errori.';

-- registra_evento: accetta p_qualita, valido solo per Ricezione+neutro
-- (altrimenti viene silenziosamente ignorato, per non rompere chiamate
-- esistenti che non lo passano o lo passano per errore).
create or replace function public.registra_evento(
  p_match_id uuid,
  p_set_id uuid,
  p_skill text,
  p_esito text,
  p_athlete_id uuid default null::uuid,
  p_qualita text default null::text
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_stato_match text;
  v_evento_id uuid;
  v_esito text;
  v_athlete uuid;
  v_posizione integer;
  v_qualita text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id, stato into v_team_id, v_stato_match from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;
  if v_stato_match = 'conclusa' then raise exception 'Partita già conclusa'; end if;
  if v_stato_match <> 'in_corso' then raise exception 'La partita non è ancora iniziata'; end if;

  if not exists (select 1 from match_sets where id = p_set_id and match_id = p_match_id for update) then
    raise exception 'Il set indicato non appartiene a questa partita';
  end if;
  if not exists (select 1 from match_set_lineups where set_id = p_set_id) then
    raise exception 'Formazione non impostata per questo set';
  end if;

  -- Eventi diretti: nessuna attribuzione e nessun esito, sempre.
  if p_skill in ('Punto_avversario','Punto_nostro','Fallo_rotazione') then
    v_esito := null;
    v_athlete := null;
  else
    v_esito := p_esito;
    v_athlete := p_athlete_id;
    if v_esito is null then raise exception 'Indica l''esito dell''azione'; end if;

    if v_athlete is not null then
      if not exists (select 1 from athletes where id = v_athlete and team_id = v_team_id) then
        raise exception 'Questa persona non fa parte della squadra';
      end if;
      -- Il servizio lo esegue solo chi è in posizione 1.
      if p_skill = 'Servizio' then
        select posizione into v_posizione from match_set_lineups
        where set_id = p_set_id and athlete_id = v_athlete and in_campo = true;
        if v_posizione is distinct from 1 then
          raise exception 'Il servizio può essere attribuito solo a chi si trova in posizione 1 (zona di battuta)';
        end if;
      end if;
    end if;
  end if;

  -- La qualità ha senso solo per una ricezione andata a buon fine.
  v_qualita := case when p_skill = 'Ricezione' and v_esito = 'neutro' then p_qualita else null end;

  insert into match_events (match_id, set_id, skill, esito, athlete_id, creato_da, qualita)
  values (p_match_id, p_set_id, p_skill, v_esito, v_athlete, auth.uid(), v_qualita)
  returning id into v_evento_id;

  return v_evento_id;
end;
$function$;

-- Side-out% / break-point% della partita, più il dettaglio qualità
-- ricezione. Stessa logica di permesso di rendimento_turni_servizio.
create or replace function public.rendimento_servizio_ricezione_partita(p_match_id uuid)
 returns table(
   punti_in_battuta integer,
   punti_vinti_in_battuta integer,
   break_point_pct numeric,
   punti_in_ricezione integer,
   punti_vinti_in_ricezione integer,
   side_out_pct numeric,
   ricezioni_ottime integer,
   ricezioni_buone integer,
   ricezioni_scarse integer,
   ricezioni_errori integer
 )
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or is_team_scout(v_team_id)) then raise exception 'Permesso negato'; end if;

  return query
  with terminali as (
    select *
    from match_events
    where match_id = p_match_id
      and servizio_precedente is not null
      and (esito in ('punto','errore') or skill in ('Punto_nostro','Punto_avversario','Fallo_rotazione'))
  )
  select
    count(*) filter (where servizio_precedente = 'noi')::integer,
    count(*) filter (where servizio_precedente = 'noi' and (esito = 'punto' or skill = 'Punto_nostro'))::integer,
    round(
      100.0 * count(*) filter (where servizio_precedente = 'noi' and (esito = 'punto' or skill = 'Punto_nostro'))
      / nullif(count(*) filter (where servizio_precedente = 'noi'), 0), 1),
    count(*) filter (where servizio_precedente = 'avversario')::integer,
    count(*) filter (where servizio_precedente = 'avversario' and (esito = 'punto' or skill = 'Punto_nostro'))::integer,
    round(
      100.0 * count(*) filter (where servizio_precedente = 'avversario' and (esito = 'punto' or skill = 'Punto_nostro'))
      / nullif(count(*) filter (where servizio_precedente = 'avversario'), 0), 1),
    (select count(*) from match_events where match_id = p_match_id and skill = 'Ricezione' and qualita = 'ottima')::integer,
    (select count(*) from match_events where match_id = p_match_id and skill = 'Ricezione' and qualita = 'buona')::integer,
    (select count(*) from match_events where match_id = p_match_id and skill = 'Ricezione' and qualita = 'scarsa')::integer,
    (select count(*) from match_events where match_id = p_match_id and skill = 'Ricezione' and esito = 'errore')::integer
  from terminali;
end;
$function$;
