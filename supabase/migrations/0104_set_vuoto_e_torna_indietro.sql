-- Nuovo set: niente più set "fantasma" e possibilità di tornare al set precedente.
--
-- Problema: per l'allenatore nuovo_set() non controllava nulla (i controlli stavano solo
-- nel ramo dello scout ospite). Due richieste ravvicinate (doppio tocco, conferma del
-- "Set concluso!" + pulsante "Nuovo set", due dispositivi) chiudevano il set appena aperto,
-- vuoto, e ne creavano un altro: es. dal set 2 si passava al 4, col set 3 a 0-0 senza azioni.
--
-- 1) nuovo_set(): se il set aperto è ancora vuoto (0-0 e nessuna azione) non ne crea un altro,
--    restituisce quello già aperto (idempotente). Il resto resta com'era.
-- 2) torna_al_set_precedente(): se il set aperto è vuoto e ce n'è uno prima, lo elimina
--    (con la sua formazione) e riapre il precedente. Un set arrivato al punteggio (25, o 15 al
--    set decisivo, con almeno 2 punti di scarto) è chiuso e consolidato: non si riapre mai.

create or replace function public.nuovo_set(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_prossimo_numero integer;
  v_set_id uuid;
  v_set match_sets%rowtype;
  v_soglia integer;
  v_punti_per_set integer;
  v_punti_decisivo integer;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;

  if not is_team_coach(v_team_id) then
    if not is_scout_ospite(p_match_id) then raise exception 'Permesso negato'; end if;
    select coalesce(c.punti_per_set, 25), coalesce(c.punti_set_decisivo, 15)
      into v_punti_per_set, v_punti_decisivo
      from matches m left join campionati c on c.id = m.campionato_id where m.id = p_match_id;
    select * into v_set from match_sets where match_id = p_match_id and concluso = false order by numero_set desc limit 1;
    if v_set.id is not null then
      v_soglia := case when v_set.numero_set = 5 then v_punti_decisivo else v_punti_per_set end;
      if not (greatest(v_set.punti_noi, v_set.punti_avversario) >= v_soglia and abs(v_set.punti_noi - v_set.punti_avversario) >= 2) then
        raise exception 'Il set non e'' ancora concluso';
      end if;
    end if;
    if (select count(*) from match_sets s where s.match_id = p_match_id and s.punti_noi > s.punti_avversario) >= 3
       or (select count(*) from match_sets s where s.match_id = p_match_id and s.punti_avversario > s.punti_noi) >= 3 then
      raise exception 'La partita e'' finita: la chiude l''allenatore';
    end if;
  end if;

  -- Set aperto ancora vuoto: è già quello giusto, non se ne crea un altro.
  select * into v_set from match_sets where match_id = p_match_id and concluso = false order by numero_set desc limit 1;
  if v_set.id is not null and v_set.punti_noi = 0 and v_set.punti_avversario = 0
     and not exists (select 1 from match_events e where e.set_id = v_set.id) then
    return v_set.id;
  end if;

  update match_sets set concluso = true where match_id = p_match_id and concluso = false;
  select coalesce(max(numero_set), 0) + 1 into v_prossimo_numero from match_sets where match_id = p_match_id;
  insert into match_sets (match_id, numero_set) values (p_match_id, v_prossimo_numero) returning id into v_set_id;
  return v_set_id;
end;
$function$;

create or replace function public.torna_al_set_precedente(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_stato text;
  v_corrente match_sets%rowtype;
  v_precedente match_sets%rowtype;
  v_punti_per_set integer;
  v_punti_decisivo integer;
  v_soglia integer;
begin
  select team_id, stato into v_team_id, v_stato from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if v_stato = 'conclusa' then raise exception 'La partita è conclusa'; end if;

  select * into v_corrente from match_sets where match_id = p_match_id and concluso = false order by numero_set desc limit 1;
  if v_corrente.id is null then raise exception 'Non c''è un set aperto'; end if;
  if v_corrente.punti_noi <> 0 or v_corrente.punti_avversario <> 0
     or exists (select 1 from match_events e where e.set_id = v_corrente.id) then
    raise exception 'Il set % è già iniziato: non si può tornare indietro', v_corrente.numero_set;
  end if;

  select * into v_precedente from match_sets
   where match_id = p_match_id and numero_set < v_corrente.numero_set
   order by numero_set desc limit 1;
  if v_precedente.id is null then raise exception 'Non c''è un set precedente'; end if;

  -- Set finito per punteggio: consolidato, non si riapre.
  select coalesce(c.punti_per_set, 25), coalesce(c.punti_set_decisivo, 15)
    into v_punti_per_set, v_punti_decisivo
    from matches m left join campionati c on c.id = m.campionato_id where m.id = p_match_id;
  v_soglia := case when v_precedente.numero_set = 5 then v_punti_decisivo else v_punti_per_set end;
  if greatest(v_precedente.punti_noi, v_precedente.punti_avversario) >= v_soglia
     and abs(v_precedente.punti_noi - v_precedente.punti_avversario) >= 2 then
    raise exception 'Il set % è finito %-% ed è consolidato: non si può riaprire', v_precedente.numero_set, v_precedente.punti_noi, v_precedente.punti_avversario;
  end if;

  -- Elimina il set vuoto (formazione e timeout collegati vanno via a cascata) e riapre il precedente.
  delete from match_sets where id = v_corrente.id;
  update match_sets set concluso = false where id = v_precedente.id;
  return v_precedente.id;
end;
$function$;

revoke execute on function public.torna_al_set_precedente(uuid) from anon;
grant execute on function public.torna_al_set_precedente(uuid) to authenticated;
