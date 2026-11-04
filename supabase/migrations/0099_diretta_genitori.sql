-- 0099 — Diretta per i genitori: link/QR "sola visione", senza account, che mostra SOLO il punteggio.
--
-- Chi gestisce la squadra (allenatore, vice, superuser) crea per una partita un link segreto da girare ai genitori.
-- Chi lo apre (anche senza account, ruolo "anon") vede soltanto:
--   nome delle due squadre, set vinti, punteggio del set in corso, risultati dei set conclusi, stato della partita.
-- NON viene mai restituito: telecronaca, azioni, nomi di atlete, formazioni, statistiche, date, luoghi, identificativi
-- interni (nemmeno l'id della partita), nome della società.
--
-- Validità del link:
--   * scade dopo 24 ore dalla creazione;
--   * smette di funzionare appena la partita è conclusa (controllo fatto a ogni lettura, nessun lavoro in background);
--   * può essere revocato o sostituito in qualsiasi momento da chi gestisce la squadra.
-- Un link scaduto, revocato, inesistente o di una partita conclusa dà la stessa identica risposta ("non_disponibile"):
-- chi indovina a caso non può capire se un codice è mai esistito.
--
-- Sicurezza:
--   * è l'unico punto in cui un utente anonimo legge dati: la funzione pubblica è SECURITY DEFINER con search_path fisso;
--   * token di 64 caratteri esadecimali generati dal database (due UUID casuali), mai scelti dal client;
--   * la tabella dei token ha RLS: i client possono solo leggere i token delle proprie partite e revocarli
--     (UPDATE limitato alla sola colonna revocato_il); creare e ruotare passa dalle funzioni, che controllano i permessi;
--   * limite semplice ai tentativi con codice non valido: oltre 60 in 10 minuti dallo stesso indirizzo la funzione
--     risponde "riprova" senza più cercare (l'indirizzo è salvato solo come impronta md5, per finestre di 10 minuti).
-- Rollback: in fondo al file (commentato).

-- ── Tabella dei link ────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists diretta_genitori_token (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches (id) on delete cascade,
  token text not null unique,
  creato_da uuid,
  creato_il timestamptz not null default now(),
  scade_il timestamptz not null default (now() + interval '24 hours'),
  revocato_il timestamptz
);
alter table diretta_genitori_token enable row level security;

-- Un solo link "attivo" per partita; quelli scaduti o revocati restano come storico (e si ripuliscono con la partita).
create unique index if not exists diretta_genitori_token_uno_attivo
  on diretta_genitori_token (match_id) where revocato_il is null;

-- Tentativi con codice non valido, per il limite semplice. Nessun accesso dai client.
create table if not exists diretta_genitori_tentativi (
  chiave text not null,
  finestra timestamptz not null,
  n integer not null default 0,
  primary key (chiave, finestra)
);
alter table diretta_genitori_tentativi enable row level security;
revoke all on diretta_genitori_tentativi from public, anon, authenticated;

-- Chi può gestire il link di una partita: staff tecnico della squadra o superuser.
create or replace function genitori_puo_gestire(p_match_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1 from matches m
    where m.id = p_match_id and (is_team_coach(m.team_id) or is_superuser())
  );
$function$;

revoke execute on function genitori_puo_gestire(uuid) from public, anon, authenticated;
grant execute on function genitori_puo_gestire(uuid) to authenticated;

-- RLS: leggere e revocare (solo la colonna revocato_il, vedi i privilegi sotto) è consentito a chi gestisce la squadra.
-- Nessuna policy di insert/delete: i link nascono solo dalle funzioni qui sotto.
drop policy if exists diretta_genitori_token_select on diretta_genitori_token;
create policy diretta_genitori_token_select on diretta_genitori_token
  for select to authenticated
  using (genitori_puo_gestire(match_id));

drop policy if exists diretta_genitori_token_revoca on diretta_genitori_token;
create policy diretta_genitori_token_revoca on diretta_genitori_token
  for update to authenticated
  using (genitori_puo_gestire(match_id))
  with check (genitori_puo_gestire(match_id));

revoke all on diretta_genitori_token from public, anon, authenticated;
grant select on diretta_genitori_token to authenticated;
grant update (revocato_il) on diretta_genitori_token to authenticated;

-- ── Staff: ottenere il link attivo (lo crea se manca o se è scaduto) ─────────────────────────────────────────────
create or replace function genitori_link_ottieni(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_stato text;
  v_token text;
  v_scade timestamptz;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.stato into v_stato from matches m where m.id = p_match_id;
  if v_stato is null then raise exception 'Partita non trovata'; end if;
  if not genitori_puo_gestire(p_match_id) then raise exception 'Permesso negato'; end if;
  if v_stato = 'conclusa' then raise exception 'La partita e'' gia'' conclusa'; end if;

  -- Un link scaduto va messo da parte per lasciare posto al nuovo (un solo attivo per partita).
  update diretta_genitori_token set revocato_il = now()
  where match_id = p_match_id and revocato_il is null and scade_il <= now();

  select g.token, g.scade_il into v_token, v_scade
  from diretta_genitori_token g
  where g.match_id = p_match_id and g.revocato_il is null and g.scade_il > now();

  if v_token is null then
    v_token := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
    insert into diretta_genitori_token (match_id, token, creato_da)
    values (p_match_id, v_token, auth.uid())
    on conflict (match_id) where revocato_il is null do nothing;
    -- Se nel frattempo ne e' nato un altro (due richieste insieme) si restituisce quello.
    select g.token, g.scade_il into v_token, v_scade
    from diretta_genitori_token g
    where g.match_id = p_match_id and g.revocato_il is null and g.scade_il > now();
  end if;

  return jsonb_build_object('token', v_token, 'scade_il', v_scade);
end;
$function$;

-- ── Staff: nuovo link (il vecchio smette subito di funzionare) ───────────────────────────────────────────────────
create or replace function genitori_link_ruota(p_match_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not exists (select 1 from matches where id = p_match_id) then raise exception 'Partita non trovata'; end if;
  if not genitori_puo_gestire(p_match_id) then raise exception 'Permesso negato'; end if;
  update diretta_genitori_token set revocato_il = now() where match_id = p_match_id and revocato_il is null;
  return genitori_link_ottieni(p_match_id);
end;
$function$;

-- ── Staff: revoca (il link smette di funzionare, finché non se ne crea un altro) ─────────────────────────────────
create or replace function genitori_link_revoca(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not exists (select 1 from matches where id = p_match_id) then raise exception 'Partita non trovata'; end if;
  if not genitori_puo_gestire(p_match_id) then raise exception 'Permesso negato'; end if;
  update diretta_genitori_token set revocato_il = now() where match_id = p_match_id and revocato_il is null;
end;
$function$;

-- ── PUBBLICA: lo stato minimo della partita, dato il link ────────────────────────────────────────────────────────
-- Risposte possibili (sempre un oggetto con "stato"):
--   non_disponibile  link inesistente, scaduto, revocato oppure partita conclusa (indistinguibili di proposito)
--   riprova          troppi tentativi con codici non validi da questo indirizzo
--   non_iniziata     la partita c'e' ma non e' ancora iniziata (solo nomi delle squadre)
--   in_corso         punteggio: set vinti, set in corso (null tra un set e l'altro), set conclusi
create or replace function diretta_genitori(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
declare
  v_chiave text;
  v_finestra timestamptz := to_timestamp(floor(extract(epoch from now()) / 600) * 600);
  v_n integer;
  v_match_id uuid;
  v_team_id uuid;
  v_stato text;
  v_avversario text;
  v_noi text;
  v_corrente jsonb;
  v_conclusi jsonb;
  v_vinti_noi integer;
  v_vinti_avv integer;
begin
  -- Impronta dell'indirizzo di chi chiama (mai l'indirizzo in chiaro).
  begin
    v_chiave := md5(coalesce(
      nullif(split_part(coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for', ''), ',', 1), ''),
      'sconosciuto'));
  exception when others then
    v_chiave := md5('sconosciuto');
  end;

  -- Pulizia saltuaria delle finestre vecchie (la tabella resta minuscola).
  if random() < 0.02 then
    delete from diretta_genitori_tentativi where finestra < now() - interval '2 hours';
  end if;

  select n into v_n from diretta_genitori_tentativi where chiave = v_chiave and finestra = v_finestra;
  if coalesce(v_n, 0) >= 60 then
    return jsonb_build_object('stato', 'riprova');
  end if;

  if p_token is not null and char_length(p_token) between 32 and 128 then
    select g.match_id into v_match_id
    from diretta_genitori_token g
    where g.token = p_token and g.revocato_il is null and g.scade_il > now();
  end if;

  if v_match_id is not null then
    select m.team_id, m.stato, m.avversario into v_team_id, v_stato, v_avversario
    from matches m where m.id = v_match_id;
    if v_stato is distinct from 'programmata' and v_stato is distinct from 'in_corso' then v_team_id := null; end if;
  end if;

  if v_team_id is null then
    insert into diretta_genitori_tentativi (chiave, finestra, n) values (v_chiave, v_finestra, 1)
    on conflict (chiave, finestra) do update set n = diretta_genitori_tentativi.n + 1;
    return jsonb_build_object('stato', 'non_disponibile');
  end if;

  select t.nome into v_noi from teams t where t.id = v_team_id;

  if v_stato = 'programmata' then
    return jsonb_build_object('stato', 'non_iniziata', 'squadra', v_noi, 'avversario', v_avversario);
  end if;

  select count(*) filter (where s.punti_noi > s.punti_avversario)::int,
         count(*) filter (where s.punti_avversario > s.punti_noi)::int,
         coalesce(jsonb_agg(jsonb_build_object('numero', s.numero_set, 'noi', s.punti_noi, 'avv', s.punti_avversario)
                            order by s.numero_set), '[]'::jsonb)
  into v_vinti_noi, v_vinti_avv, v_conclusi
  from match_sets s where s.match_id = v_match_id and s.concluso;

  select jsonb_build_object('numero', s.numero_set, 'noi', s.punti_noi, 'avv', s.punti_avversario)
  into v_corrente
  from match_sets s where s.match_id = v_match_id and not s.concluso
  order by s.numero_set limit 1;

  return jsonb_build_object(
    'stato', 'in_corso',
    'squadra', v_noi,
    'avversario', v_avversario,
    'set_vinti_noi', coalesce(v_vinti_noi, 0),
    'set_vinti_avv', coalesce(v_vinti_avv, 0),
    'set_in_corso', v_corrente,
    'set_conclusi', v_conclusi
  );
end;
$function$;

-- ── Permessi ─────────────────────────────────────────────────────────────────────────────────────────────────────
revoke execute on function genitori_link_ottieni(uuid) from public, anon, authenticated;
revoke execute on function genitori_link_ruota(uuid) from public, anon, authenticated;
revoke execute on function genitori_link_revoca(uuid) from public, anon, authenticated;
revoke execute on function diretta_genitori(text) from public, anon, authenticated;
grant execute on function genitori_link_ottieni(uuid) to authenticated;
grant execute on function genitori_link_ruota(uuid) to authenticated;
grant execute on function genitori_link_revoca(uuid) to authenticated;
grant execute on function diretta_genitori(text) to anon, authenticated;

-- ── Verifiche ────────────────────────────────────────────────────────────────────────────────────────────────────
-- select has_function_privilege('anon', 'diretta_genitori(text)', 'execute');             -- true
-- select has_function_privilege('anon', 'genitori_link_ottieni(uuid)', 'execute');        -- false
-- select has_table_privilege('anon', 'diretta_genitori_token', 'select');                 -- false
-- select diretta_genitori('0000000000000000000000000000000000');                          -- {"stato": "non_disponibile"}

-- ── Rollback ─────────────────────────────────────────────────────────────────────────────────────────────────────
-- drop function if exists diretta_genitori(text);
-- drop function if exists genitori_link_revoca(uuid);
-- drop function if exists genitori_link_ruota(uuid);
-- drop function if exists genitori_link_ottieni(uuid);
-- drop table if exists diretta_genitori_tentativi;
-- drop table if exists diretta_genitori_token;
-- drop function if exists genitori_puo_gestire(uuid);
