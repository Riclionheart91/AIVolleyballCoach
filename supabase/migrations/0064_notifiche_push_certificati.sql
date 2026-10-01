-- 0064 — Notifiche push per certificati medici in scadenza
--
-- Richiesta: un reminder push reale (deve arrivare anche ad app chiusa)
-- ogni venerdì mattina. Allenatore e vice-allenatore ricevono UNA
-- notifica con l'elenco di tutte le atlete della squadra con
-- certificato scaduto o in scadenza; ogni atleta riceve una notifica
-- solo per il PROPRIO certificato. Soglia di preavviso: 30 giorni,
-- la stessa già usata dal centro notifiche in-app (vedi
-- src/services/notifiche.ts, GIORNI_PREAVVISO_CERTIFICATO).
--
-- Tabella: un abbonamento push (endpoint + chiavi) per dispositivo/
-- browser, legato all'utente che lo ha creato. Non è legato a una
-- squadra: un utente può stare su più squadre con ruoli diversi, la
-- funzione che invia le notifiche incrocia comunque per squadra al
-- momento dell'invio tramite team_members.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  chiave_p256dh text not null,
  chiave_auth text not null,
  creato_il timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

drop policy if exists "push_subscriptions_select_own" on push_subscriptions;
create policy "push_subscriptions_select_own" on push_subscriptions for select using (user_id = auth.uid());

drop policy if exists "push_subscriptions_delete_own" on push_subscriptions;
create policy "push_subscriptions_delete_own" on push_subscriptions for delete using (user_id = auth.uid());

-- Niente policy insert/update dirette: si passa sempre da questa
-- funzione, che gestisce anche il caso di un endpoint già registrato
-- da un altro account sullo stesso dispositivo/browser (es. logout e
-- login con un utente diverso su un telefono condiviso).
create or replace function salva_abbonamento_push(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Devi essere autenticato.';
  end if;

  insert into push_subscriptions (user_id, endpoint, chiave_p256dh, chiave_auth)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        chiave_p256dh = excluded.chiave_p256dh,
        chiave_auth = excluded.chiave_auth;
end;
$$;

grant execute on function salva_abbonamento_push(text, text, text) to authenticated;

-- Scheduler: pg_cron per il job settimanale, pg_net per chiamare
-- l'edge function via HTTP dal database senza esporre nessuna chiave
-- nei file del progetto (i valori veri sono in Supabase Vault, non
-- qui: questa migrazione referenzia solo i NOMI dei secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'notifica_certificati_venerdi') then
    perform cron.unschedule('notifica_certificati_venerdi');
  end if;
end $$;

-- Ogni venerdì alle 06:30 UTC (~08:30 in Italia con l'ora legale,
-- ~07:30 con l'ora solare — pg_cron lavora in UTC, non esiste un
-- singolo orario locale che valga tutto l'anno senza gestione fusi
-- orari più complessa, ma resta comunque mattina presto in entrambi i
-- casi).
select cron.schedule(
  'notifica_certificati_venerdi',
  '30 6 * * 5',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'certificati_project_url') || '/functions/v1/notifica-certificati',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'certificati_publishable_key')
    ),
    body := '{}'::jsonb
  ) as request_id;
  $cron$
);
