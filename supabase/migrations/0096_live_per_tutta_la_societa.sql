-- 0096 — Live per tutta la società.
-- Chiunque abbia accesso a una squadra di una società (atlete, staff, presidente) può vedere l'andamento delle
-- partite IN CORSO di tutte le squadre di quella società, in sola lettura: punteggi, set e azioni punto per punto.
-- Il superuser le vede tutte. Finita la partita (stato diverso da 'in_corso') non è più raggiungibile da qui e
-- tutto torna come prima: analisi e azioni restano governate dalle regole di sempre.
--
-- Si fa con due funzioni "security definer" che restituiscono solo ciò che serve alla live (nome, cognome, maglia
-- e ruolo in campo delle convocate: nessun dato anagrafico), senza toccare le regole di lettura delle tabelle.
-- Rollback: in fondo al file (commentato).

-- Le società di cui l'utente fa parte (squadra o presidenza). Interna: non richiamabile dal client.
create or replace function societa_con_accesso_live()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select t.societa_id
  from team_members tm join teams t on t.id = tm.team_id
  where tm.user_id = auth.uid() and t.societa_id is not null
  union
  select sp.societa_id
  from societa_presidenti sp
  where sp.user_id = auth.uid() and sp.fine_mandato is null;
$function$;

revoke execute on function societa_con_accesso_live() from public, anon, authenticated;

-- Elenco delle partite in corso visibili a chi chiama.
create or replace function live_partite_in_corso()
returns table(
  match_id uuid, team_id uuid, team_nome text, societa_nome text, avversario text,
  set_corrente integer, punti_noi integer, punti_avversario integer,
  set_vinti_noi integer, set_vinti_avversario integer
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  select m.id, m.team_id, t.nome, so.nome, m.avversario,
         coalesce(cur.numero_set, 1), coalesce(cur.punti_noi, 0), coalesce(cur.punti_avversario, 0),
         (select count(*)::int from match_sets x where x.match_id = m.id and x.concluso and x.punti_noi > x.punti_avversario),
         (select count(*)::int from match_sets x where x.match_id = m.id and x.concluso and x.punti_avversario > x.punti_noi)
  from matches m
  join teams t on t.id = m.team_id
  left join societa so on so.id = t.societa_id
  left join lateral (
    select x.numero_set, x.punti_noi, x.punti_avversario
    from match_sets x
    where x.match_id = m.id
    order by (case when x.concluso then 1 else 0 end), (case when x.concluso then -x.numero_set else x.numero_set end)
    limit 1
  ) cur on true
  where auth.uid() is not null
    and m.stato = 'in_corso'
    and (is_superuser() or t.societa_id in (select societa_con_accesso_live()))
  order by m.data desc;
$function$;

-- Stato completo di una partita in corso, nella stessa forma usata dallo scout ospite, con TUTTE le azioni.
create or replace function live_stato_partita(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_camp uuid;
  v_set_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.team_id, m.campionato_id into v_team_id, v_camp
  from matches m join teams t on t.id = m.team_id
  where m.id = p_match_id and m.stato = 'in_corso'
    and (is_superuser() or t.societa_id in (select societa_con_accesso_live()));
  if v_team_id is null then raise exception 'Permesso negato'; end if;

  select id into v_set_id from match_sets where match_id = p_match_id and not concluso order by numero_set limit 1;
  if v_set_id is null then
    select id into v_set_id from match_sets where match_id = p_match_id order by numero_set desc limit 1;
  end if;

  return jsonb_build_object(
    'match', (select to_jsonb(m) - 'sporteasy_uid' - 'creato_da' - 'luogo' from matches m where m.id = p_match_id),
    'team_nome', (select t.nome from teams t where t.id = v_team_id),
    'set_attivo_id', v_set_id,
    'sets', coalesce((select jsonb_agg(to_jsonb(s) order by s.numero_set) from match_sets s where s.match_id = p_match_id), '[]'::jsonb),
    'eventi', coalesce((
      select jsonb_agg(to_jsonb(x) - 'creato_da' order by x.creato_il desc)
      from match_events x where x.match_id = p_match_id
    ), '[]'::jsonb),
    'atlete', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'team_id', a.team_id, 'nome', a.nome, 'cognome', a.cognome,
        'numero_maglia', a.numero_maglia, 'ruolo_campo', a.ruolo_campo
      ) order by a.cognome)
      from match_convocati c join athletes a on a.id = c.athlete_id where c.match_id = p_match_id
    ), '[]'::jsonb),
    'convocati', coalesce((
      select jsonb_agg(jsonb_build_object('athlete_id', c.athlete_id, 'is_libero', c.is_libero))
      from match_convocati c where c.match_id = p_match_id
    ), '[]'::jsonb),
    'formazione', case when v_set_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(to_jsonb(l)) from match_set_lineups l where l.set_id = v_set_id
    ), '[]'::jsonb) end,
    'libero', case when v_set_id is null then null else (select to_jsonb(x) from libero_in_campo(v_set_id) x limit 1) end,
    'timeouts', coalesce((
      select jsonb_agg(to_jsonb(t) - 'creato_da' order by t.creato_il) from match_timeouts t where t.match_id = p_match_id
    ), '[]'::jsonb),
    'regole', (
      select jsonb_build_object('puntiPerSet', coalesce(c.punti_per_set, 25), 'puntiSetDecisivo', coalesce(c.punti_set_decisivo, 15))
      from (select 1) d left join campionati c on c.id = v_camp
    )
  );
end;
$function$;

revoke execute on function live_partite_in_corso() from public, anon;
revoke execute on function live_stato_partita(uuid) from public, anon;
grant execute on function live_partite_in_corso() to authenticated;
grant execute on function live_stato_partita(uuid) to authenticated;

-- ── Verifiche ────────────────────────────────────────────────────────────────────────────────────────────────
-- select has_function_privilege('anon', 'live_stato_partita(uuid)', 'execute');            -- false
-- select has_function_privilege('authenticated', 'societa_con_accesso_live()', 'execute'); -- false

-- ── Rollback ─────────────────────────────────────────────────────────────────────────────────────────────────
-- drop function if exists live_stato_partita(uuid);
-- drop function if exists live_partite_in_corso();
-- drop function if exists societa_con_accesso_live();
