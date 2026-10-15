-- Scout OSPITE: una persona esterna alla squadra, invitata per email su UNA
-- sola partita. Vede e scouta solo quella partita, solo finche' e' "in_corso".
-- Appena la partita viene chiusa l'accesso decade da solo (nessuna pulizia).
--
-- Scelte di sicurezza:
--  * l'accesso e' per PARTITA, non per squadra: non si tocca is_team_scout(),
--    altrimenti l'ospite vedrebbe anche tutte le altre partite della squadra;
--  * l'ospite NON ha nessuna policy di lettura sulle tabelle: legge tutto da
--    un'unica funzione (scout_ospite_stato_partita) che restituisce solo i
--    campi che servono (nome, cognome, maglia, ruolo): mai codice fiscale,
--    telefono, data di nascita ecc.;
--  * puo' fare cio' che gia' fa uno scout (registrare, annullare, cambi,
--    libero) ma NON aprire/chiudere set e partite, ne' vedere analisi.

-- ---------------------------------------------------------------------------
-- 1. Tabella degli inviti ospite
-- ---------------------------------------------------------------------------
create table if not exists scout_ospiti_partita (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches(id) on delete cascade,
  email text not null check (email = lower(email)),
  invitato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  unique (match_id, email)
);

create index if not exists scout_ospiti_partita_email_idx on scout_ospiti_partita (email);

alter table scout_ospiti_partita enable row level security;

-- Solo staff tecnico della squadra (o superuser) vede chi e' stato invitato.
-- Nessuna policy di scrittura: si scrive solo tramite le funzioni qui sotto.
drop policy if exists "scout_ospiti_select_staff" on scout_ospiti_partita;
create policy "scout_ospiti_select_staff" on scout_ospiti_partita for select using (
  is_superuser() or is_team_coach((select m.team_id from matches m where m.id = match_id))
);

revoke all on scout_ospiti_partita from anon;
revoke insert, update, delete on scout_ospiti_partita from authenticated;
grant select on scout_ospiti_partita to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Chi e' ospite di quale partita
-- ---------------------------------------------------------------------------
create or replace function is_scout_ospite(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from scout_ospiti_partita o
    join matches m on m.id = o.match_id
    where o.match_id = p_match_id
      and m.stato = 'in_corso'
      and o.email = lower((select u.email from auth.users u where u.id = auth.uid()))
  );
$$;

create or replace function is_scout_ospite_set(p_set_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from match_sets ms
    where ms.id = p_set_id and is_scout_ospite(ms.match_id)
  );
$$;

revoke execute on function is_scout_ospite(uuid) from public, anon;
revoke execute on function is_scout_ospite_set(uuid) from public, anon;
grant execute on function is_scout_ospite(uuid) to authenticated;
grant execute on function is_scout_ospite_set(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Invitare / rimuovere un ospite (solo allenatore/vice della squadra o superuser)
-- ---------------------------------------------------------------------------
create or replace function invita_scout_ospite(p_match_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato text;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id, stato into v_team_id, v_stato from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if v_stato = 'conclusa' then raise exception 'La partita e'' gia'' conclusa'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Indirizzo email non valido'; end if;

  insert into scout_ospiti_partita (match_id, email, invitato_da)
  values (p_match_id, v_email, auth.uid())
  on conflict (match_id, email) do nothing;
end;
$$;

create or replace function rimuovi_scout_ospite(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.team_id into v_team_id
  from scout_ospiti_partita o join matches m on m.id = o.match_id
  where o.id = p_id;
  if v_team_id is null then return; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  delete from scout_ospiti_partita where id = p_id;
end;
$$;

revoke execute on function invita_scout_ospite(uuid, text) from public, anon;
revoke execute on function rimuovi_scout_ospite(uuid) from public, anon;
grant execute on function invita_scout_ospite(uuid, text) to authenticated;
grant execute on function rimuovi_scout_ospite(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Le partite a cui l'utente corrente e' stato invitato come ospite
-- ---------------------------------------------------------------------------
create or replace function mie_partite_scout_ospite()
returns table (match_id uuid, team_nome text, avversario text, data timestamptz, stato text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, t.nome, m.avversario, m.data, m.stato
  from scout_ospiti_partita o
  join matches m on m.id = o.match_id
  join teams t on t.id = m.team_id
  where o.email = lower((select u.email from auth.users u where u.id = auth.uid()))
    and m.stato in ('programmata', 'in_corso')
  order by (m.stato = 'in_corso') desc, m.data;
$$;

revoke execute on function mie_partite_scout_ospite() from public, anon;
grant execute on function mie_partite_scout_ospite() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Tutto cio' che l'ospite vede della partita, in una sola chiamata
-- ---------------------------------------------------------------------------
create or replace function scout_ospite_stato_partita(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_set_id uuid;
  v_camp uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_scout_ospite(p_match_id) then raise exception 'Permesso negato'; end if;

  select team_id, campionato_id into v_team_id, v_camp from matches where id = p_match_id;

  select id into v_set_id from match_sets
  where match_id = p_match_id and not concluso
  order by numero_set limit 1;
  if v_set_id is null then
    select id into v_set_id from match_sets
    where match_id = p_match_id
    order by numero_set desc limit 1;
  end if;

  return jsonb_build_object(
    'match', (select to_jsonb(m) - 'sporteasy_uid' - 'creato_da' - 'luogo' from matches m where m.id = p_match_id),
    'team_nome', (select t.nome from teams t where t.id = v_team_id),
    'set_attivo_id', v_set_id,
    'sets', coalesce((select jsonb_agg(to_jsonb(s) order by s.numero_set) from match_sets s where s.match_id = p_match_id), '[]'::jsonb),
    'eventi', coalesce((
      select jsonb_agg(to_jsonb(x) - 'creato_da' order by x.creato_il desc)
      from (select * from match_events where match_id = p_match_id order by creato_il desc limit 20) x
    ), '[]'::jsonb),
    'atlete', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'team_id', a.team_id, 'nome', a.nome, 'cognome', a.cognome,
        'numero_maglia', a.numero_maglia, 'ruolo_campo', a.ruolo_campo
      ) order by a.cognome)
      from match_convocati c join athletes a on a.id = c.athlete_id
      where c.match_id = p_match_id
    ), '[]'::jsonb),
    'convocati', coalesce((
      select jsonb_agg(jsonb_build_object('athlete_id', c.athlete_id, 'is_libero', c.is_libero))
      from match_convocati c where c.match_id = p_match_id
    ), '[]'::jsonb),
    'formazione', case when v_set_id is null then '[]'::jsonb else coalesce((
      select jsonb_agg(to_jsonb(l)) from match_set_lineups l where l.set_id = v_set_id
    ), '[]'::jsonb) end,
    'libero', case when v_set_id is null then null else (
      select to_jsonb(x) from libero_in_campo(v_set_id) x limit 1
    ) end,
    'regole', (
      select jsonb_build_object('puntiPerSet', coalesce(c.punti_per_set, 25), 'puntiSetDecisivo', coalesce(c.punti_set_decisivo, 15))
      from (select 1) d left join campionati c on c.id = v_camp
    )
  );
end;
$$;

revoke execute on function scout_ospite_stato_partita(uuid) from public, anon;
grant execute on function scout_ospite_stato_partita(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Le funzioni di scouting accettano anche l'ospite della PARTITA
--    (stessa definizione di oggi, cambia solo la riga del controllo permessi).
--    Se il testo atteso non viene trovato la migrazione si ferma: meglio un
--    errore che una funzione lasciata a meta'.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_oid oid;
  v_def text;
  v_new text;
begin
  for r in
    select * from (values
      ('registra_evento', 'p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid, p_qualita text',
        'if not is_team_scout(v_team_id) then raise exception ''Permesso negato''; end if;',
        'if not (is_team_scout(v_team_id) or is_scout_ospite(p_match_id)) then raise exception ''Permesso negato''; end if;'),
      ('annulla_ultimo_evento', 'p_match_id uuid',
        'if not is_team_scout(v_team_id) then raise exception ''Permesso negato''; end if;',
        'if not (is_team_scout(v_team_id) or is_scout_ospite(p_match_id)) then raise exception ''Permesso negato''; end if;'),
      ('cambia_giocatore', 'p_set_id uuid, p_atleta_uscente uuid, p_atleta_entrante uuid',
        'if not is_team_scout(v_team_id) then raise exception ''Permesso negato''; end if;',
        'if not (is_team_scout(v_team_id) or is_scout_ospite_set(p_set_id)) then raise exception ''Permesso negato''; end if;'),
      ('fai_uscire_libero', 'p_set_id uuid',
        'if not is_team_scout(v_team_id) then raise exception ''Permesso negato''; end if;',
        'if not (is_team_scout(v_team_id) or is_scout_ospite_set(p_set_id)) then raise exception ''Permesso negato''; end if;'),
      ('rimpiazza_con_libero', 'p_set_id uuid, p_libero_id uuid, p_titolare_id uuid',
        'if not is_team_scout(v_team_id) then raise exception ''Permesso negato''; end if;',
        'if not (is_team_scout(v_team_id) or is_scout_ospite_set(p_set_id)) then raise exception ''Permesso negato''; end if;'),
      ('libero_in_campo', 'p_set_id uuid',
        'and is_team_scout((select m.team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id))',
        'and (is_team_scout((select m.team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id)) or is_scout_ospite_set(p_set_id))')
    ) as t(nome, argomenti, vecchio, nuovo)
  loop
    select p.oid into v_oid
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = r.nome
      and pg_get_function_identity_arguments(p.oid) = r.argomenti;
    if v_oid is null then
      raise exception 'Funzione %(%) non trovata', r.nome, r.argomenti;
    end if;

    v_def := pg_get_functiondef(v_oid);
    v_new := replace(v_def, r.vecchio, r.nuovo);
    if v_new = v_def then
      raise exception 'Controllo permessi non trovato in %(%): migrazione interrotta', r.nome, r.argomenti;
    end if;
    execute v_new;
  end loop;
end;
$$;
