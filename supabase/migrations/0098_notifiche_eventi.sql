-- 0098 — Notifiche push per eventi: partita in diretta e convocazioni.
--
-- Generalizza l'infrastruttura push già presente (0064: tabella push_subscriptions + salva_abbonamento_push,
-- pg_net per chiamare le edge function dal database, chiavi lette da Supabase Vault). NON modifica nulla di
-- quanto esiste: aggiunge soltanto
--
--   1. preferenze_notifiche   — una riga per (utente, tipo di notifica): l'utente sceglie cosa ricevere.
--                               Nessuna riga = notifica NON attiva (si riceve solo se l'utente l'ha accesa).
--                               Tipi: 'partita_live', 'convocazioni'. RLS: ognuno vede/modifica solo le proprie.
--   2. imposta_preferenza_notifica(tipo, attiva) — l'unico modo (RPC) con cui il client scrive le preferenze.
--   3. notifiche_eventi_coda  — registro interno (nessun accesso dal client) che serve a:
--                                 - 'partita_live': mandare UN solo avviso per partita, anche se la partita viene
--                                   azzerata e riavviata;
--                                 - 'convocazioni': raggruppare le modifiche alla distinta (la funzione
--                                   imposta_convocati cancella e reinserisce tutte le righe: senza questo registro
--                                   partirebbe una notifica per ogni riga) e ricordare a chi è già stato scritto,
--                                   così un aggiornamento avvisa solo chi è stata aggiunta o tolta.
--   4. Trigger su matches (la partita passa a 'in_corso' -> invio immediato) e su match_convocati (insert/delete ->
--      accodamento con attesa di 2 minuti) e un job pg_cron al minuto che invia le convocazioni accodate.
--
-- Destinatari (decisi dall'edge function notifica-eventi, con la chiave di servizio, dopo aver controllato le
-- preferenze di ciascuno):
--   - partita_live: i membri della squadra della partita (atlete, allenatore, vice, scout, presidente di squadra) e i
--     presidenti in carica della società di quella squadra. Non esiste un ruolo "genitore". Stessa visibilità della
--     live (0096), ristretta alla sola squadra + presidenza per non inondare di avvisi le altre squadre.
--   - convocazioni: solo le atlete (team_members.ruolo = 'atleta') collegate alle convocate aggiunte o tolte.
--
-- Configurazione richiesta (una volta, da fare a mano; nessun valore segreto è in questo file):
--   a) Vault:  select vault.create_secret('<stringa casuale lunga>', 'notifiche_eventi_secret');
--   b) Secret della funzione:  supabase secrets set NOTIFICHE_EVENTI_SECRET='<la stessa stringa>'
--   c) Restano validi i secret già esistenti: 'certificati_project_url' e 'certificati_publishable_key' (Vault) e
--      VAPID_PRIVATE_JWK (secret della funzione).
-- Se mancano (o se l'edge function non è distribuita) i trigger NON falliscono e non bloccano mai l'operazione
-- originale (avvio partita, convocati): l'invio salta e basta, con un warning nel log del database.

create extension if not exists pg_net;

-- 1. Preferenze ----------------------------------------------------------------------------------------------
create table if not exists preferenze_notifiche (
  user_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('partita_live', 'convocazioni')),
  attiva boolean not null default false,
  aggiornato_il timestamptz not null default now(),
  primary key (user_id, tipo)
);

alter table preferenze_notifiche enable row level security;

drop policy if exists "preferenze_notifiche_select_own" on preferenze_notifiche;
create policy "preferenze_notifiche_select_own" on preferenze_notifiche for select using (user_id = auth.uid());

-- Scrittura solo tramite imposta_preferenza_notifica (security definer): niente policy insert/update/delete dirette.
revoke all on table preferenze_notifiche from public, anon;
revoke insert, update, delete on table preferenze_notifiche from authenticated;
grant select on table preferenze_notifiche to authenticated;

create or replace function imposta_preferenza_notifica(p_tipo text, p_attiva boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Devi essere autenticato.';
  end if;
  if p_tipo not in ('partita_live', 'convocazioni') then
    raise exception 'Tipo di notifica non valido.';
  end if;

  insert into preferenze_notifiche (user_id, tipo, attiva, aggiornato_il)
  values (auth.uid(), p_tipo, coalesce(p_attiva, false), now())
  on conflict (user_id, tipo) do update
    set attiva = excluded.attiva, aggiornato_il = now();
end;
$$;

revoke execute on function imposta_preferenza_notifica(text, boolean) from public, anon;
grant execute on function imposta_preferenza_notifica(text, boolean) to authenticated;

-- 2. Registro interno ----------------------------------------------------------------------------------------
create table if not exists notifiche_eventi_coda (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('partita_live', 'convocazioni')),
  match_id uuid not null references matches(id) on delete cascade,
  dopo timestamptz not null default now(),       -- non inviare prima di questo istante (solo convocazioni)
  inviata_il timestamptz,                         -- null = da inviare
  atlete_notificate uuid[] not null default '{}', -- convocazioni: atlete già in lista all'ultimo invio
  creato_il timestamptz not null default now(),
  unique (tipo, match_id)
);

alter table notifiche_eventi_coda enable row level security;
-- Nessuna policy: né anon né authenticated vi accedono. Lo usano solo le funzioni interne e l'edge function
-- (chiave di servizio, che salta la RLS).
revoke all on table notifiche_eventi_coda from public, anon, authenticated;

-- 3. Chiamata all'edge function (interna) --------------------------------------------------------------------
create or replace function invoca_notifica_eventi(p_tipo text, p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_chiave text;
  v_segreto text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'certificati_project_url';
  select decrypted_secret into v_chiave from vault.decrypted_secrets where name = 'certificati_publishable_key';
  select decrypted_secret into v_segreto from vault.decrypted_secrets where name = 'notifiche_eventi_secret';

  if v_url is null or v_chiave is null or v_segreto is null then
    raise warning 'Notifica eventi non inviata: secret Vault mancanti (certificati_project_url, certificati_publishable_key, notifiche_eventi_secret).';
    return;
  end if;

  perform net.http_post(
    url := v_url || '/functions/v1/notifica-eventi',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_chiave,
      'x-notifiche-secret', v_segreto
    ),
    body := jsonb_build_object('tipo', p_tipo, 'match_id', p_match_id)
  );
exception when others then
  raise warning 'Notifica eventi non inviata (%): %', p_tipo, sqlerrm;
end;
$$;

revoke execute on function invoca_notifica_eventi(text, uuid) from public, anon, authenticated;

-- 4. Trigger: la partita passa a "in corso" -------------------------------------------------------------------
create or replace function trg_notifica_partita_live()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nuova uuid;
begin
  begin
    if new.stato = 'in_corso' and (tg_op = 'INSERT' or old.stato is distinct from 'in_corso') then
      -- Una sola volta per partita: se la partita viene azzerata e riavviata, non si riavvisa.
      insert into notifiche_eventi_coda (tipo, match_id, dopo, inviata_il)
      values ('partita_live', new.id, now(), now())
      on conflict (tipo, match_id) do nothing
      returning id into v_nuova;

      if v_nuova is not null then
        perform invoca_notifica_eventi('partita_live', new.id);
      end if;
    end if;
  exception when others then
    raise warning 'Accodamento notifica partita in diretta fallito: %', sqlerrm;
  end;
  return new;
end;
$$;

revoke execute on function trg_notifica_partita_live() from public, anon, authenticated;

drop trigger if exists trg_notifica_partita_live on matches;
create trigger trg_notifica_partita_live
  after insert or update of stato on matches
  for each row when (new.stato = 'in_corso')
  execute function trg_notifica_partita_live();

-- 5. Trigger: cambiano le convocate di una partita ------------------------------------------------------------
create or replace function trg_notifica_convocazioni()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
begin
  begin
    if tg_op = 'DELETE' then v_match := old.match_id; else v_match := new.match_id; end if;

    -- Partite concluse (o già cancellate: cascata) non interessano.
    if exists (select 1 from matches where id = v_match and stato <> 'conclusa') then
      insert into notifiche_eventi_coda (tipo, match_id, dopo, inviata_il)
      values ('convocazioni', v_match, now() + interval '2 minutes', null)
      on conflict (tipo, match_id) do update
        set dopo = excluded.dopo, inviata_il = null;
    end if;
  exception when others then
    raise warning 'Accodamento notifica convocazioni fallito: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function trg_notifica_convocazioni() from public, anon, authenticated;

drop trigger if exists trg_notifica_convocazioni on match_convocati;
create trigger trg_notifica_convocazioni
  after insert or delete on match_convocati
  for each row execute function trg_notifica_convocazioni();

-- 6. Svuotamento della coda convocazioni (job al minuto) -------------------------------------------------------
create or replace function elabora_coda_notifiche_eventi()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in
    with scadute as (
      update notifiche_eventi_coda
         set inviata_il = now()
       where tipo = 'convocazioni' and inviata_il is null and dopo <= now()
      returning match_id
    )
    select match_id from scadute
  loop
    perform invoca_notifica_eventi('convocazioni', r.match_id);
  end loop;
end;
$$;

revoke execute on function elabora_coda_notifiche_eventi() from public, anon, authenticated;

do $$
begin
  create extension if not exists pg_cron;

  if exists (select 1 from cron.job where jobname = 'notifiche_eventi_coda') then
    perform cron.unschedule('notifiche_eventi_coda');
  end if;

  perform cron.schedule('notifiche_eventi_coda', '* * * * *', 'select elabora_coda_notifiche_eventi();');
exception when others then
  raise warning 'Job pg_cron notifiche_eventi_coda non creato: %', sqlerrm;
end $$;

-- ── Verifiche ────────────────────────────────────────────────────────────────────────────────────────────────
-- select has_function_privilege('authenticated', 'invoca_notifica_eventi(text, uuid)', 'execute');  -- false
-- select has_function_privilege('authenticated', 'imposta_preferenza_notifica(text, boolean)', 'execute'); -- true
-- select has_function_privilege('anon', 'imposta_preferenza_notifica(text, boolean)', 'execute');         -- false
-- select jobname, schedule from cron.job where jobname = 'notifiche_eventi_coda';

-- ── Rollback ─────────────────────────────────────────────────────────────────────────────────────────────────
-- select cron.unschedule('notifiche_eventi_coda');
-- drop trigger if exists trg_notifica_convocazioni on match_convocati;
-- drop trigger if exists trg_notifica_partita_live on matches;
-- drop function if exists elabora_coda_notifiche_eventi();
-- drop function if exists trg_notifica_convocazioni();
-- drop function if exists trg_notifica_partita_live();
-- drop function if exists invoca_notifica_eventi(text, uuid);
-- drop function if exists imposta_preferenza_notifica(text, boolean);
-- drop table if exists notifiche_eventi_coda;
-- drop table if exists preferenze_notifiche;
