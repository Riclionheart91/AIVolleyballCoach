-- 0093 — Accesso con email e password (senza Google) e reset con conferma dell'allenatore
--
-- Chi non usa Google entra con l'email scritta in anagrafica e una password scelta da lui.
-- Non c'e' un invio di email: la prova che e' la persona giusta e' un link personale, monouso e valido
-- 7 giorni, che chi gestisce la squadra manda su WhatsApp. L'attivazione dell'account (creazione utente,
-- password) e' fatta dalla edge function `attiva-accesso` con la service role, che poi chiama
-- `collega_accesso_da_link` per agganciare l'utente alla squadra.
--
-- Reset password: chi l'ha dimenticata lo chiede dalla schermata di login (`richiedi_reset_accesso`, senza
-- sessione). La richiesta arriva nel centro notifiche di chi puo' confermarla (e come push, tramite la edge
-- function `notifica-reset-accesso`). Alla conferma nasce un nuovo link, da mandare su WhatsApp.
--   - atlete: allenatore e vice della squadra (e chi gia' gestisce gli inviti: presidente, superuser);
--   - staff: presidente (e co-presidenti) della societa' e superuser; MAI chi ha fatto la richiesta.
--
-- Non cambia nulla per chi entra con Google: `accetta_inviti_pendenti` resta com'e'.

-- 1. TABELLE ---------------------------------------------------------------------------------------------

create table if not exists richieste_reset_accesso (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  societa_id uuid references societa(id) on delete cascade,
  ambito text not null check (ambito in ('atleta', 'staff')),
  atleta_id uuid references athletes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text not null check (email = lower(btrim(email))),
  nome text,
  stato text not null default 'in_attesa' check (stato in ('in_attesa', 'confermata', 'rifiutata')),
  creata_il timestamptz not null default now(),
  gestita_da uuid references auth.users(id) on delete set null,
  gestita_il timestamptz
);

-- Una sola richiesta in attesa per persona e squadra: chi preme piu' volte non riempie le notifiche.
create unique index if not exists idx_richieste_reset_in_attesa
  on richieste_reset_accesso (team_id, email) where stato = 'in_attesa';
create index if not exists idx_richieste_reset_email_data on richieste_reset_accesso (email, creata_il);
create index if not exists idx_richieste_reset_societa on richieste_reset_accesso (societa_id) where stato = 'in_attesa';
alter table richieste_reset_accesso enable row level security;

create table if not exists link_accesso (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  societa_id uuid references societa(id) on delete cascade,
  ruolo text not null check (ruolo in ('atleta', 'allenatore', 'vice_allenatore')),
  atleta_id uuid references athletes(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  email text check (email is null or email = lower(btrim(email))),
  tipo text not null check (tipo in ('invito', 'reset')),
  token text not null unique,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  scade_il timestamptz not null default now() + interval '7 days',
  usato_il timestamptz,
  usato_da uuid references auth.users(id) on delete set null,
  tentativi integer not null default 0,
  richiesta_id uuid references richieste_reset_accesso(id) on delete set null,
  -- Come per team_members: un'atleta ha sempre la sua scheda.
  constraint link_accesso_atleta_obbligatoria check (ruolo <> 'atleta' or atleta_id is not null)
);
create index if not exists idx_link_accesso_team on link_accesso (team_id);
create index if not exists idx_link_accesso_atleta on link_accesso (atleta_id) where usato_il is null;
create index if not exists idx_link_accesso_user on link_accesso (user_id) where usato_il is null;
alter table link_accesso enable row level security;

-- 2. FUNZIONI DI SERVIZIO (interne) ---------------------------------------------------------------------

-- Metodo con cui una persona entra: 'google' o 'password'.
--  1. se esiste gia' un account con quell'email vale il suo metodo (identita' Google presente = google);
--  2. altrimenti gmail.com e googlemail.com sono Google, tutto il resto e' password.
-- Chi gestisce la squadra puo' sempre correggere il caso particolare (es. email di societa' su Google
-- Workspace) passando p_metodo a crea_link_accesso_atleta.
create or replace function metodo_accesso_interno(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_utente uuid;
begin
  select u.id into v_utente from auth.users u where lower(u.email) = v_email limit 1;
  if v_utente is not null then
    if exists (select 1 from auth.identities i where i.user_id = v_utente and i.provider = 'google') then
      return 'google';
    end if;
    return 'password';
  end if;
  if v_email like '%@gmail.com' or v_email like '%@googlemail.com' then
    return 'google';
  end if;
  return 'password';
end;
$$;

-- Chi ha il diritto di vedere e gestire una richiesta di reset.
-- Mai chi l'ha fatta (stessa email o stesso utente).
--  - ambito 'atleta': chi gestisce gli inviti della squadra (allenatore, vice, presidente, superuser);
--  - ambito 'staff': presidente (non terminato) della societa' della richiesta, oppure superuser.
create or replace function puo_gestire_reset_accesso(p_ambito text, p_team_id uuid, p_societa_id uuid, p_email text, p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_mia_email text;
begin
  if auth.uid() is null then return false; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then return false; end if;

  select lower(u.email) into v_mia_email from auth.users u where u.id = auth.uid();
  if (p_user_id is not null and p_user_id = auth.uid()) or (v_mia_email is not null and v_mia_email = p_email) then
    return false;
  end if;

  if p_ambito = 'atleta' then
    return puo_gestire_inviti_staff(p_team_id);
  end if;

  if is_superuser() then return true; end if;
  if p_societa_id is null then return false; end if;
  return exists (
    select 1 from societa_presidenti sp
    where sp.societa_id = p_societa_id and sp.user_id = auth.uid() and sp.fine_mandato is null
  );
end;
$$;

-- 3. POLICY DI LETTURA ----------------------------------------------------------------------------------
-- Nessuna policy per anon e nessuna scrittura diretta: si passa sempre dalle funzioni.
-- I link di tipo 'reset' NON si leggono dalla tabella (il token di un reset dello staff non deve arrivare
-- all'allenatore): li vede solo chi li crea, alla conferma, dal valore di ritorno della funzione.

drop policy if exists link_accesso_lettura on link_accesso;
create policy link_accesso_lettura on link_accesso for select to authenticated
  using (tipo = 'invito' and puo_gestire_inviti_staff(team_id));

drop policy if exists richieste_reset_lettura on richieste_reset_accesso;
create policy richieste_reset_lettura on richieste_reset_accesso for select to authenticated
  using (puo_gestire_reset_accesso(ambito, team_id, societa_id, email, user_id));

-- 4. FUNZIONI PER L'APP ---------------------------------------------------------------------------------

-- Metodo di accesso previsto per un'email, per decidere quale messaggio mandare.
-- Solo per chi gestisce almeno una squadra o una societa': non e' un servizio per sapere chi ha un account.
create or replace function metodo_accesso_per_email(p_email text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Permesso negato'; end if;
  if not (
    is_superuser()
    or exists (select 1 from team_members tm where tm.user_id = auth.uid() and tm.ruolo in ('allenatore', 'vice_allenatore'))
    or exists (select 1 from societa_presidenti sp where sp.user_id = auth.uid() and sp.fine_mandato is null)
  ) then
    raise exception 'Permesso negato';
  end if;
  return metodo_accesso_interno(p_email);
end;
$$;

-- Link di accesso per un'atleta, partendo dall'email di anagrafica (athletes.email_contatto).
-- Se il metodo e' 'google' non crea nessun link (l'invito resta quello di sempre, via invita_membro) e
-- restituisce token nullo; se e' 'password' annulla i link non usati precedenti e ne crea uno nuovo.
create or replace function crea_link_accesso_atleta(p_atleta_id uuid, p_metodo text default null)
returns table (token text, metodo text, email text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_team uuid;
  v_societa uuid;
  v_email text;
  v_metodo text;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Permesso negato'; end if;

  select a.team_id, lower(btrim(coalesce(a.email_contatto, ''))), t.societa_id
    into v_team, v_email, v_societa
  from athletes a join teams t on t.id = a.team_id
  where a.id = p_atleta_id;
  if v_team is null then raise exception 'Scheda atleta non trovata'; end if;
  if not puo_gestire_inviti_staff(v_team) then raise exception 'Permesso negato'; end if;
  if v_email = '' or position('@' in v_email) = 0 then
    raise exception 'Scrivi prima l''email nella scheda dell''atleta';
  end if;

  v_metodo := coalesce(p_metodo, metodo_accesso_interno(v_email));
  if v_metodo not in ('google', 'password') then raise exception 'Metodo non valido'; end if;

  if v_metodo = 'google' then
    return query select null::text, v_metodo, v_email;
    return;
  end if;

  delete from link_accesso l where l.atleta_id = p_atleta_id and l.usato_il is null;
  insert into link_accesso (team_id, societa_id, ruolo, atleta_id, email, tipo, token, creato_da)
  values (v_team, v_societa, 'atleta', p_atleta_id, v_email, 'invito', v_token, auth.uid());

  return query select v_token, v_metodo, v_email;
end;
$$;

-- Link di accesso per un collaboratore dello staff (solo password: con Google resta crea_invito_link).
-- L'email e' facoltativa: se manca, chi apre il link sceglie la sua.
create or replace function crea_link_accesso_staff(p_team_id uuid, p_ruolo text, p_email text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_societa uuid;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Permesso negato'; end if;
  if not puo_gestire_inviti_staff(p_team_id) then raise exception 'Permesso negato'; end if;
  if p_ruolo not in ('allenatore', 'vice_allenatore') then raise exception 'Ruolo non valido'; end if;
  if v_email is not null and position('@' in v_email) = 0 then raise exception 'Email non valida'; end if;

  select t.societa_id into v_societa from teams t where t.id = p_team_id;
  if not found then raise exception 'Squadra non trovata'; end if;

  if v_email is not null then
    delete from link_accesso l
    where l.team_id = p_team_id and l.email = v_email and l.tipo = 'invito' and l.usato_il is null;
  end if;

  insert into link_accesso (team_id, societa_id, ruolo, email, tipo, token, creato_da)
  values (p_team_id, v_societa, p_ruolo, v_email, 'invito', v_token, auth.uid());
  return v_token;
end;
$$;

-- Anteprima per chi apre il link (anche senza sessione): solo i dati serviti alla pagina di attivazione,
-- e solo se il link e' valido. email_libera = true quando chi apre il link sceglie lui l'email (staff senza email).
create or replace function anteprima_link_accesso(p_token text)
returns table (team_nome text, ruolo text, email text, nome text, tipo text, email_libera boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.nome,
    l.ruolo,
    coalesce(l.email, lower(u.email)),
    case
      when l.atleta_id is not null then (select a.nome || ' ' || a.cognome from athletes a where a.id = l.atleta_id)
      else coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
    end,
    l.tipo,
    (l.email is null and l.user_id is null)
  from link_accesso l
  join teams t on t.id = l.team_id
  left join auth.users u on u.id = l.user_id
  where l.token = p_token and l.usato_il is null and l.scade_il > now() and l.tentativi < 10;
$$;

-- Richiesta di reset dalla schermata di login (nessuna sessione). Non rivela mai se l'email esiste:
-- risponde sempre allo stesso modo. Limiti: massimo 3 richieste in 24 ore per email e una sola in attesa.
-- Prima si cerca un'atleta con quell'email di anagrafica, poi un collaboratore dello staff (account con
-- quell'email e ruolo allenatore/vice): per lo staff la richiesta e' legata alla societa'.
create or replace function richiedi_reset_accesso(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_recenti integer;
  v_disponibili integer;
  v_trovata boolean := false;
  r record;
begin
  if v_email = '' or length(v_email) > 254 or position('@' in v_email) = 0 then return; end if;

  select count(*) into v_recenti from richieste_reset_accesso x
  where x.email = v_email and x.creata_il > now() - interval '24 hours';
  v_disponibili := 3 - v_recenti;
  if v_disponibili <= 0 then return; end if;

  -- 1. atlete con questa email di anagrafica
  for r in
    select a.id, a.team_id, t.societa_id, btrim(a.nome || ' ' || a.cognome) as nome
    from athletes a join teams t on t.id = a.team_id
    where lower(btrim(coalesce(a.email_contatto, ''))) = v_email and a.status = 'attiva'
    order by a.creato_il
    limit v_disponibili
  loop
    v_trovata := true;
    insert into richieste_reset_accesso (team_id, societa_id, ambito, atleta_id, email, nome)
    values (r.team_id, r.societa_id, 'atleta', r.id, v_email, r.nome)
    on conflict (team_id, email) where stato = 'in_attesa' do nothing;
  end loop;
  if v_trovata then return; end if;

  -- 2. collaboratori dello staff: una richiesta per societa' (o per squadra, se non ha una societa')
  for r in
    select distinct on (coalesce(t.societa_id, t.id))
      t.id as team_id, t.societa_id, u.id as user_id,
      coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', u.email) as nome
    from auth.users u
    join team_members tm on tm.user_id = u.id and tm.ruolo in ('allenatore', 'vice_allenatore')
    join teams t on t.id = tm.team_id
    where lower(u.email) = v_email
    order by coalesce(t.societa_id, t.id), t.id
    limit v_disponibili
  loop
    insert into richieste_reset_accesso (team_id, societa_id, ambito, user_id, email, nome)
    values (r.team_id, r.societa_id, 'staff', r.user_id, v_email, r.nome)
    on conflict (team_id, email) where stato = 'in_attesa' do nothing;
  end loop;
end;
$$;

-- Richieste in attesa che l'utente puo' gestire, viste dalla squadra corrente.
--  - atlete: quelle della squadra p_team_id;
--  - staff: quelle della societa' della squadra (o della sola squadra, se non ha una societa'); il superuser le
--    vede tutte. Mai le proprie.
create or replace function elenca_richieste_reset(p_team_id uuid)
returns table (id uuid, ambito text, nome text, email text, atleta_id uuid, creata_il timestamptz, telefono text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_societa uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Permesso negato'; end if;
  select t.societa_id into v_societa from teams t where t.id = p_team_id;

  return query
  select r.id, r.ambito, r.nome, r.email, r.atleta_id, r.creata_il,
         case when r.atleta_id is not null then (select a.telefono from athletes a where a.id = r.atleta_id) end
  from richieste_reset_accesso r
  where r.stato = 'in_attesa'
    and puo_gestire_reset_accesso(r.ambito, r.team_id, r.societa_id, r.email, r.user_id)
    and (
      (r.ambito = 'atleta' and r.team_id = p_team_id)
      or (r.ambito = 'staff' and (
            is_superuser()
            or (r.societa_id is not null and r.societa_id = v_societa)
            or (r.societa_id is null and r.team_id = p_team_id)
         ))
    )
  order by r.creata_il;
end;
$$;

-- Conferma di una richiesta: crea il nuovo link (7 giorni, per staff legato all'account esistente) e segna la
-- richiesta come confermata. Se l'email entra con Google non c'e' nessun link: token nullo e metodo 'google'
-- (il messaggio WhatsApp dira' di accedere con Google). Il telefono e' quello di anagrafica, se c'e'.
create or replace function conferma_reset_accesso(p_richiesta_id uuid)
returns table (token text, metodo text, email text, nome text, telefono text, squadra text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r richieste_reset_accesso%rowtype;
  v_metodo text;
  v_ruolo text;
  v_utente uuid;
  v_telefono text;
  v_squadra text;
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Permesso negato'; end if;

  select * into r from richieste_reset_accesso x where x.id = p_richiesta_id for update;
  if not found then raise exception 'Richiesta non trovata'; end if;
  if not puo_gestire_reset_accesso(r.ambito, r.team_id, r.societa_id, r.email, r.user_id) then
    raise exception 'Permesso negato';
  end if;
  if r.stato <> 'in_attesa' then raise exception 'Richiesta gia'' gestita'; end if;

  select t.nome into v_squadra from teams t where t.id = r.team_id;
  v_metodo := metodo_accesso_interno(r.email);

  if r.ambito = 'atleta' then
    select a.telefono into v_telefono from athletes a where a.id = r.atleta_id;
    select tm.user_id into v_utente from team_members tm where tm.team_id = r.team_id and tm.atleta_id = r.atleta_id limit 1;
    v_ruolo := 'atleta';
  else
    v_utente := r.user_id;
    select tm.ruolo into v_ruolo from team_members tm where tm.team_id = r.team_id and tm.user_id = r.user_id;
    if v_ruolo is null then raise exception 'Questa persona non fa piu'' parte della squadra'; end if;
  end if;

  update richieste_reset_accesso x
    set stato = 'confermata', gestita_da = auth.uid(), gestita_il = now()
    where x.id = r.id;

  if v_metodo = 'google' then
    return query select null::text, v_metodo, r.email, r.nome, v_telefono, v_squadra;
    return;
  end if;

  delete from link_accesso l
  where l.usato_il is null and l.team_id = r.team_id
    and ((r.atleta_id is not null and l.atleta_id = r.atleta_id) or (r.atleta_id is null and l.user_id = r.user_id));

  insert into link_accesso (team_id, societa_id, ruolo, atleta_id, user_id, email, tipo, token, creato_da, richiesta_id)
  values (r.team_id, r.societa_id, v_ruolo, r.atleta_id, v_utente, r.email, 'reset', v_token, auth.uid(), r.id);

  return query select v_token, v_metodo, r.email, r.nome, v_telefono, v_squadra;
end;
$$;

create or replace function rifiuta_reset_accesso(p_richiesta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r richieste_reset_accesso%rowtype;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Permesso negato'; end if;

  select * into r from richieste_reset_accesso x where x.id = p_richiesta_id for update;
  if not found then raise exception 'Richiesta non trovata'; end if;
  if not puo_gestire_reset_accesso(r.ambito, r.team_id, r.societa_id, r.email, r.user_id) then
    raise exception 'Permesso negato';
  end if;
  if r.stato <> 'in_attesa' then return; end if;

  update richieste_reset_accesso x
    set stato = 'rifiutata', gestita_da = auth.uid(), gestita_il = now()
    where x.id = r.id;
end;
$$;

-- 5. COLLEGAMENTO (SOLO SERVER) -------------------------------------------------------------------------
-- Chiamata dalla edge function `attiva-accesso` con la service role, DOPO aver creato (o aggiornato) l'utente.
-- Valida il link e aggancia l'utente alla squadra con il ruolo del link (e la scheda atleta). Restituisce
-- l'id della squadra. Per qualunque problema (link inesistente, usato, scaduto, email o utente che non
-- coincidono, troppi tentativi) restituisce NULL, senza dire quale: i tentativi falliti si contano sul link
-- (si resta bloccati a 10) e si salvano, per questo non si solleva un'eccezione.
create or replace function collega_accesso_da_link(p_token text, p_user_id uuid, p_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link link_accesso%rowtype;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  select * into v_link from link_accesso l where l.token = p_token for update;
  if not found then return null; end if;
  if v_link.usato_il is not null or v_link.scade_il <= now() or v_link.tentativi >= 10 then return null; end if;

  if p_user_id is null
     or v_email = ''
     or (v_link.email is not null and v_link.email <> v_email)
     or (v_link.user_id is not null and v_link.user_id <> p_user_id)
     or not exists (select 1 from auth.users u where u.id = p_user_id and lower(u.email) = v_email) then
    update link_accesso l set tentativi = l.tentativi + 1 where l.id = v_link.id;
    return null;
  end if;

  -- Il reset di un account gia' agganciato alla squadra non aggiunge nulla; negli altri casi (primo accesso,
  -- oppure reset di chi non aveva mai attivato l'account) l'utente entra in squadra con il ruolo del link.
  insert into team_members (team_id, user_id, ruolo, atleta_id)
  values (v_link.team_id, p_user_id, v_link.ruolo, v_link.atleta_id)
  on conflict (team_id, user_id) do nothing;

  update link_accesso l set usato_il = now(), usato_da = p_user_id where l.id = v_link.id;
  return v_link.team_id;
end;
$$;

-- 6. PUSH ALLA RICHIESTA DI RESET -----------------------------------------------------------------------
-- Alla nuova richiesta il database chiama la edge function `notifica-reset-accesso`, con lo stesso schema
-- del job del venerdi' (0064): URL e chiave pubblicabile sono nel Vault. Un errore qui non deve mai
-- impedire di registrare la richiesta: la notifica in-app resta comunque.
create or replace function notifica_richiesta_reset_accesso()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'certificati_project_url') || '/functions/v1/notifica-reset-accesso',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'certificati_publishable_key')
      ),
      body := jsonb_build_object('richiesta_id', new.id)
    );
  exception when others then
    raise warning 'Push reset accesso non inviato: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists trg_notifica_reset_accesso on richieste_reset_accesso;
create trigger trg_notifica_reset_accesso
  after insert on richieste_reset_accesso
  for each row execute function notifica_richiesta_reset_accesso();

-- 7. PERMESSI -------------------------------------------------------------------------------------------

revoke execute on function metodo_accesso_interno(text) from public, anon, authenticated;
revoke execute on function puo_gestire_reset_accesso(text, uuid, uuid, text, uuid) from public, anon;
revoke execute on function metodo_accesso_per_email(text) from public, anon;
revoke execute on function crea_link_accesso_atleta(uuid, text) from public, anon;
revoke execute on function crea_link_accesso_staff(uuid, text, text) from public, anon;
revoke execute on function anteprima_link_accesso(text) from public;
revoke execute on function richiedi_reset_accesso(text) from public;
revoke execute on function elenca_richieste_reset(uuid) from public, anon;
revoke execute on function conferma_reset_accesso(uuid) from public, anon;
revoke execute on function rifiuta_reset_accesso(uuid) from public, anon;
revoke execute on function collega_accesso_da_link(text, uuid, text) from public, anon, authenticated;
revoke execute on function notifica_richiesta_reset_accesso() from public, anon, authenticated;

-- puo_gestire_reset_accesso serve alle policy di lettura, eseguite con il ruolo di chi legge.
grant execute on function puo_gestire_reset_accesso(text, uuid, uuid, text, uuid) to authenticated;
grant execute on function metodo_accesso_per_email(text) to authenticated;
grant execute on function crea_link_accesso_atleta(uuid, text) to authenticated;
grant execute on function crea_link_accesso_staff(uuid, text, text) to authenticated;
grant execute on function anteprima_link_accesso(text) to anon, authenticated;
grant execute on function richiedi_reset_accesso(text) to anon, authenticated;
grant execute on function elenca_richieste_reset(uuid) to authenticated;
grant execute on function conferma_reset_accesso(uuid) to authenticated;
grant execute on function rifiuta_reset_accesso(uuid) to authenticated;
grant execute on function collega_accesso_da_link(text, uuid, text) to service_role;

-- ==========================================================================================================
-- VERIFICHE MANUALI (dopo l'applicazione; non fanno parte della migrazione)
-- ==========================================================================================================
--  1. select proname, proacl from pg_proc where proname in ('collega_accesso_da_link', 'metodo_accesso_interno',
--     'notifica_richiesta_reset_accesso'); -> nessun grant a anon/authenticated.
--  2. Da anon (senza sessione): select * from anteprima_link_accesso('x'); -> 0 righe, nessun errore.
--     select richiedi_reset_accesso('nessuno@example.com'); -> void, e nessuna riga in richieste_reset_accesso.
--  3. Da un allenatore: select * from crea_link_accesso_atleta('<id atleta con email hotmail>'); -> token,
--     metodo 'password', email; richiamandola, il link precedente sparisce (select count(*) from link_accesso).
--     Con email @gmail.com: token nullo e metodo 'google'.
--  4. Da anon: select richiedi_reset_accesso('<email atleta>'); due volte di fila -> una sola riga in attesa;
--     la richiesta compare in elenca_richieste_reset('<team>') dell'allenatore, non della stessa atleta.
--  5. conferma_reset_accesso(<id>) dall'allenatore -> nuovo link tipo 'reset'; rifare la conferma -> errore
--     "Richiesta gia' gestita". Lo staff: la conferma da un allenatore deve dare "Permesso negato"; dal
--     presidente o dal superuser riesce.
--  6. Dalla service role: collega_accesso_da_link('<token>', '<user id>', '<email>') -> id squadra; stessa
--     chiamata di nuovo -> NULL. Con email diversa -> NULL e tentativi + 1.
--  7. Il trigger: dopo un insert in richieste_reset_accesso, select * from net._http_response order by created desc
--     limit 3; (la funzione notifica-reset-accesso deve esistere gia', altrimenti risposta 404).
--
-- ROLLBACK (da eseguire a mano solo se serve annullare tutto; cancella anche i link e le richieste esistenti)
--   drop trigger if exists trg_notifica_reset_accesso on richieste_reset_accesso;
--   drop function if exists notifica_richiesta_reset_accesso();
--   drop function if exists collega_accesso_da_link(text, uuid, text);
--   drop function if exists rifiuta_reset_accesso(uuid);
--   drop function if exists conferma_reset_accesso(uuid);
--   drop function if exists elenca_richieste_reset(uuid);
--   drop function if exists richiedi_reset_accesso(text);
--   drop function if exists anteprima_link_accesso(text);
--   drop function if exists crea_link_accesso_staff(uuid, text, text);
--   drop function if exists crea_link_accesso_atleta(uuid, text);
--   drop function if exists metodo_accesso_per_email(text);
--   drop policy if exists link_accesso_lettura on link_accesso;
--   drop policy if exists richieste_reset_lettura on richieste_reset_accesso;
--   drop function if exists puo_gestire_reset_accesso(text, uuid, uuid, text, uuid);
--   drop function if exists metodo_accesso_interno(text);
--   drop table if exists link_accesso;
--   drop table if exists richieste_reset_accesso;
