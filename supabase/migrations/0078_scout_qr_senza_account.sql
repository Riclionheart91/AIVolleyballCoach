-- Scout senza account tramite QR: ogni partita ha un codice (token) segreto; chi lo apre
-- sceglie un nome, entra con un accesso anonimo e diventa scout ospite di quella partita
-- finche' la partita non e' conclusa. Lo staff puo' cambiare il codice o escludere una persona.
-- Al massimo uno scout alla volta ha il "turno" per registrare; gli altri guardano e possono subentrare.
-- Lo scout ospite puo' aprire il set successivo (solo a set finito) e inserire la formazione.

create table if not exists scout_qr_partita (
  match_id uuid primary key references matches (id) on delete cascade,
  token text not null unique,
  creato_il timestamptz not null default now()
);
alter table scout_qr_partita enable row level security;

create table if not exists scout_anonimi_partita (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches (id) on delete cascade,
  user_id uuid not null,
  nome text not null,
  escluso boolean not null default false,
  creato_il timestamptz not null default now(),
  unique (match_id, user_id)
);
alter table scout_anonimi_partita enable row level security;

create table if not exists scout_turno_partita (
  match_id uuid primary key references matches (id) on delete cascade,
  user_id uuid not null,
  nome text not null,
  ultimo_segnale timestamptz not null default now()
);
alter table scout_turno_partita enable row level security;

-- Scout ospite: invitato per email OPPURE agganciato col QR (accesso anonimo non escluso), a partita in corso.
create or replace function is_scout_ospite(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from matches m
    where m.id = p_match_id and m.stato = 'in_corso'
      and (
        exists (
          select 1 from scout_ospiti_partita o
          where o.match_id = m.id and o.email = lower((select u.email from auth.users u where u.id = auth.uid()))
        )
        or exists (
          select 1 from scout_anonimi_partita a
          where a.match_id = m.id and a.user_id = auth.uid() and not a.escluso
        )
      )
  );
$$;

create or replace function mie_partite_scout_ospite()
returns table (match_id uuid, team_nome text, avversario text, data timestamptz, stato text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, t.nome, m.avversario, m.data, m.stato
  from matches m
  join teams t on t.id = m.team_id
  where m.stato in ('programmata', 'in_corso')
    and (
      exists (
        select 1 from scout_ospiti_partita o
        where o.match_id = m.id and o.email = lower((select u.email from auth.users u where u.id = auth.uid()))
      )
      or exists (
        select 1 from scout_anonimi_partita a
        where a.match_id = m.id and a.user_id = auth.uid() and not a.escluso
      )
    )
  order by (m.stato = 'in_corso') desc, m.data;
$$;

-- Staff: il codice della partita (lo crea la prima volta).
create or replace function scout_qr_ottieni(p_match_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato text;
  v_token text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id, stato into v_team_id, v_stato from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if v_stato = 'conclusa' then raise exception 'La partita e'' gia'' conclusa'; end if;
  insert into scout_qr_partita (match_id, token)
  values (p_match_id, replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''))
  on conflict (match_id) do nothing;
  select token into v_token from scout_qr_partita where match_id = p_match_id;
  return v_token;
end;
$$;

-- Staff: nuovo codice. Chi e' gia' dentro resta dentro; il vecchio QR smette di funzionare.
create or replace function scout_qr_ruota(p_match_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  insert into scout_qr_partita (match_id, token) values (p_match_id, v_token)
  on conflict (match_id) do update set token = excluded.token, creato_il = now();
  return v_token;
end;
$$;

-- Chi ha aperto il QR (accesso anonimo) si aggancia alla partita con il suo nome. Restituisce la partita.
create or replace function scout_qr_aggancia(p_token text, p_nome text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_nome text := btrim(coalesce(p_nome, ''));
  v_escluso boolean;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) is not true then
    raise exception 'Questo accesso e'' riservato a chi non ha un account';
  end if;
  if char_length(v_nome) < 2 or char_length(v_nome) > 40 then raise exception 'Scrivi il tuo nome (da 2 a 40 caratteri)'; end if;
  select q.match_id into v_match_id
  from scout_qr_partita q join matches m on m.id = q.match_id
  where q.token = p_token and m.stato <> 'conclusa';
  if v_match_id is null then raise exception 'QR non valido o partita conclusa'; end if;
  select escluso into v_escluso from scout_anonimi_partita where match_id = v_match_id and user_id = auth.uid();
  if v_escluso then raise exception 'Accesso revocato dallo staff'; end if;
  if v_escluso is null and (select count(*) from scout_anonimi_partita where match_id = v_match_id and not escluso) >= 10 then
    raise exception 'Troppi scout collegati a questa partita';
  end if;
  insert into scout_anonimi_partita (match_id, user_id, nome) values (v_match_id, auth.uid(), v_nome)
  on conflict (match_id, user_id) do update set nome = excluded.nome;
  return v_match_id;
end;
$$;

-- Staff: scout collegati col QR e chi ha il turno adesso.
create or replace function scout_anonimi_elenco(p_match_id uuid)
returns table (id uuid, nome text, escluso boolean, creato_il timestamptz, ha_turno boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  return query
    select a.id, a.nome, a.escluso, a.creato_il,
           coalesce((select t.user_id = a.user_id and t.ultimo_segnale > now() - interval '60 seconds' from scout_turno_partita t where t.match_id = a.match_id), false)
    from scout_anonimi_partita a
    where a.match_id = p_match_id
    order by a.creato_il;
end;
$$;

-- Staff: esclude (o riammette) uno scout del QR; se aveva il turno lo perde.
create or replace function scout_anonimo_escludi(p_id uuid, p_escluso boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_user_id uuid;
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select a.match_id, a.user_id, m.team_id into v_match_id, v_user_id, v_team_id
  from scout_anonimi_partita a join matches m on m.id = a.match_id where a.id = p_id;
  if v_match_id is null then raise exception 'Scout non trovato'; end if;
  if not (is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  update scout_anonimi_partita set escluso = p_escluso where id = p_id;
  if p_escluso then delete from scout_turno_partita where match_id = v_match_id and user_id = v_user_id; end if;
end;
$$;

-- Turno di scouting: chi ha il turno (o lo staff che lo libera) registra, gli altri guardano.
create or replace function scout_turno_stato(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  t scout_turno_partita%rowtype;
  v_attivo boolean;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not (is_scout_ospite(p_match_id) or is_team_coach(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  select * into t from scout_turno_partita where match_id = p_match_id;
  v_attivo := t.match_id is not null and t.ultimo_segnale > now() - interval '60 seconds';
  return jsonb_build_object(
    'occupato', v_attivo,
    'nome', case when v_attivo then t.nome end,
    'mio', v_attivo and t.user_id = auth.uid()
  );
end;
$$;

create or replace function scout_turno_prendi(p_match_id uuid, p_forza boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_scout_ospite(p_match_id) then raise exception 'Permesso negato'; end if;
  select a.nome into v_nome from scout_anonimi_partita a where a.match_id = p_match_id and a.user_id = auth.uid();
  if v_nome is null then
    select split_part(u.email, '@', 1) into v_nome from auth.users u where u.id = auth.uid();
  end if;
  v_nome := coalesce(nullif(btrim(v_nome), ''), 'Scout');
  insert into scout_turno_partita (match_id, user_id, nome, ultimo_segnale)
  values (p_match_id, auth.uid(), v_nome, now())
  on conflict (match_id) do update
    set user_id = excluded.user_id, nome = excluded.nome, ultimo_segnale = now()
    where scout_turno_partita.user_id = auth.uid()
       or scout_turno_partita.ultimo_segnale < now() - interval '60 seconds'
       or coalesce(p_forza, false);
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Turno occupato'; end if;
end;
$$;

-- Segnale di presenza di chi ha il turno: dopo un minuto senza segnali il turno si libera. true = hai ancora il turno.
create or replace function scout_turno_battito(p_match_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  update scout_turno_partita set ultimo_segnale = now() where match_id = p_match_id and user_id = auth.uid();
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

create or replace function scout_turno_rilascia(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if is_team_coach(v_team_id) or is_superuser() then
    delete from scout_turno_partita where match_id = p_match_id;
  else
    delete from scout_turno_partita where match_id = p_match_id and user_id = auth.uid();
  end if;
end;
$$;

-- Prossimo set: lo staff sempre; lo scout ospite solo a set finito (punteggio da regolamento) e se la partita non e' decisa.
create or replace function nuovo_set(p_match_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
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

  update match_sets set concluso = true where match_id = p_match_id and concluso = false;

  select coalesce(max(numero_set), 0) + 1 into v_prossimo_numero from match_sets where match_id = p_match_id;
  insert into match_sets (match_id, numero_set) values (p_match_id, v_prossimo_numero) returning id into v_set_id;

  return v_set_id;
end;
$$;

-- Formazione di partenza del set: staff o scout ospite (solo se nel set non e' ancora stato registrato nulla).
create or replace function imposta_formazione_iniziale(p_set_id uuid, p_posizioni jsonb, p_chi_serve text default 'noi')
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_chiave text;
  v_athlete uuid;
  v_conteggio integer := 0;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.id, m.team_id into v_match_id, v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not (is_team_coach(v_team_id) or is_scout_ospite(v_match_id)) then raise exception 'Permesso negato'; end if;
  if exists (select 1 from match_events where set_id = p_set_id) then
    raise exception 'Il set è già iniziato: la formazione non può più essere cambiata, usa i cambi';
  end if;
  delete from match_set_lineups where set_id = p_set_id;
  delete from rimpiazzi_libero where set_id = p_set_id;
  for v_chiave in select jsonb_object_keys(p_posizioni) loop
    v_athlete := (p_posizioni ->> v_chiave)::uuid;
    if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = v_athlete) then
      raise exception 'Una delle persone indicate non è tra i convocati';
    end if;
    insert into match_set_lineups (set_id, athlete_id, posizione, posizione_iniziale, in_campo)
    values (p_set_id, v_athlete, v_chiave::integer, v_chiave::integer, true);
    v_conteggio := v_conteggio + 1;
  end loop;
  if v_conteggio <> 6 then raise exception 'Servono esattamente 6 posizioni, ne sono arrivate %', v_conteggio; end if;
  update match_sets set squadra_al_servizio = p_chi_serve, chi_ha_servito_per_primo = p_chi_serve where id = p_set_id;
end;
$$;

-- Stato della partita per lo scout ospite: in piu' la formazione di partenza del set precedente
-- e chi ha servito per primo, per proporre la formazione del set nuovo.
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
  v_numero integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_scout_ospite(p_match_id) then raise exception 'Permesso negato'; end if;
  select team_id, campionato_id into v_team_id, v_camp from matches where id = p_match_id;
  select id into v_set_id from match_sets where match_id = p_match_id and not concluso order by numero_set limit 1;
  if v_set_id is null then
    select id into v_set_id from match_sets where match_id = p_match_id order by numero_set desc limit 1;
  end if;
  select numero_set into v_numero from match_sets where id = v_set_id;
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
    ),
    'precedente', jsonb_build_object(
      'formazione', coalesce((
        select jsonb_agg(jsonb_build_object('athlete_id', l.athlete_id, 'posizione', l.posizione_iniziale))
        from match_set_lineups l join match_sets s on s.id = l.set_id
        where s.match_id = p_match_id and s.numero_set = v_numero - 1 and l.posizione_iniziale is not null
      ), '[]'::jsonb),
      'chi_ha_servito_per_primo', (
        select s.chi_ha_servito_per_primo from match_sets s where s.match_id = p_match_id and s.numero_set = v_numero - 1
      )
    )
  );
end;
$$;

revoke execute on function scout_qr_ottieni(uuid) from public, anon;
revoke execute on function scout_qr_ruota(uuid) from public, anon;
revoke execute on function scout_qr_aggancia(text, text) from public, anon;
revoke execute on function scout_anonimi_elenco(uuid) from public, anon;
revoke execute on function scout_anonimo_escludi(uuid, boolean) from public, anon;
revoke execute on function scout_turno_stato(uuid) from public, anon;
revoke execute on function scout_turno_prendi(uuid, boolean) from public, anon;
revoke execute on function scout_turno_battito(uuid) from public, anon;
revoke execute on function scout_turno_rilascia(uuid) from public, anon;
grant execute on function scout_qr_ottieni(uuid) to authenticated;
grant execute on function scout_qr_ruota(uuid) to authenticated;
grant execute on function scout_qr_aggancia(text, text) to authenticated;
grant execute on function scout_anonimi_elenco(uuid) to authenticated;
grant execute on function scout_anonimo_escludi(uuid, boolean) to authenticated;
grant execute on function scout_turno_stato(uuid) to authenticated;
grant execute on function scout_turno_prendi(uuid, boolean) to authenticated;
grant execute on function scout_turno_battito(uuid) to authenticated;
grant execute on function scout_turno_rilascia(uuid) to authenticated;
