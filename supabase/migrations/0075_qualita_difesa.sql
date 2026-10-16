-- La difesa, come la ricezione, non vale mai punto: si registra con la stessa
-- scala di qualita' (perfetta, buona, scarsa) oppure errore.
-- Unica modifica a registra_evento: la qualita' viene salvata anche per la
-- Difesa andata a buon fine (prima solo per la Ricezione).

create or replace function public.registra_evento(p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid default null::uuid, p_qualita text default null::text)
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
  if not (is_team_scout(v_team_id) or is_scout_ospite(p_match_id)) then raise exception 'Permesso negato'; end if;
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

  -- La qualità ha senso solo per una ricezione o una difesa andata a buon fine.
  v_qualita := case when p_skill in ('Ricezione', 'Difesa') and v_esito = 'neutro' then p_qualita else null end;

  insert into match_events (match_id, set_id, skill, esito, athlete_id, creato_da, qualita)
  values (p_match_id, p_set_id, p_skill, v_esito, v_athlete, auth.uid(), v_qualita)
  returning id into v_evento_id;

  return v_evento_id;
end;
$function$;
