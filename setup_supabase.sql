-- ============================================================
-- F1 — Anagrafica base (equivalente di V0 in AIVolleyballCoach GAS)
-- Atlete, esercizi, allenamenti, presenze, RPE, valutazioni manuali.
-- Numerata "0001" per lasciare spazio a F2..F4 prima di F5 (AI), come
-- il vecchio release-manifest.json lasciava i .5 liberi tra le versioni.
-- Idempotente: eseguibile più volte senza effetti collaterali.
-- ============================================================

-- 1. TEAMS ---------------------------------------------------------
-- Sostituisce il concetto "uno spreadsheet = una squadra": qui più
-- squadre possono condividere lo stesso progetto Supabase.
create table if not exists teams (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  creato_da uuid references auth.users on delete set null,
  creato_il timestamptz not null default now()
);

-- 2. TEAM_MEMBERS ----------------------------------------------------
-- Sostituisce il foglio "Utenti" (Auth.gs). Un utente Supabase Auth può
-- appartenere a più team con ruoli diversi. atleta_id collega un membro
-- (es. un'atleta che vuole vedere i propri dati) alla riga in "athletes".
create table if not exists team_members (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  ruolo text not null check (ruolo in ('allenatore', 'vice_allenatore')),
  atleta_id uuid, -- FK aggiunta più sotto dopo la creazione di "athletes"
  creato_il timestamptz not null default now(),
  unique (team_id, user_id)
);

-- Funzioni helper per le policy RLS, usate da tutte le tabelle di dominio.
create or replace function is_team_member(p_team_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function is_team_coach(p_team_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
      and ruolo in ('allenatore', 'vice_allenatore')
  );
$$;

-- 3. ATHLETES --------------------------------------------------------
create table if not exists athletes (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  nome text not null,
  cognome text not null,
  ruolo_campo text, -- es. schiacciatrice, palleggiatrice, libero...
  numero_maglia integer,
  data_nascita date,
  status text not null default 'attiva' check (status in ('attiva', 'archiviata')),
  creato_il timestamptz not null default now()
);

alter table team_members drop constraint if exists team_members_atleta_id_fkey;
alter table team_members
  add constraint team_members_atleta_id_fkey
  foreign key (atleta_id) references athletes on delete set null;

-- 4. EXERCISES ---------------------------------------------------------
create table if not exists exercises (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  nome text not null,
  categoria text, -- es. tecnica, atletica, tattica...
  descrizione text default '',
  creato_il timestamptz not null default now()
);

-- 5. TRAININGS + TRAINING_EXERCISES -------------------------------------
create table if not exists trainings (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  data timestamptz not null,
  titolo text not null default 'Allenamento',
  note text default '',
  creato_il timestamptz not null default now()
);

create table if not exists training_exercises (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings on delete cascade,
  exercise_id uuid not null references exercises on delete restrict,
  serie integer,
  ripetizioni text, -- testo libero: "10", "30 sec", "3x8"...
  note text default '',
  ordine integer not null default 0
);

-- 6. ATTENDANCE ----------------------------------------------------------
create table if not exists attendance (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  presente boolean not null default true,
  motivo_assenza text default '',
  registrato_il timestamptz not null default now(),
  unique (training_id, athlete_id)
);

-- 7. RPE (Rate of Perceived Exertion) -------------------------------------
create table if not exists rpe (
  id uuid primary key default gen_random_uuid(),
  training_id uuid not null references trainings on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  valore integer not null check (valore between 1 and 10),
  registrato_il timestamptz not null default now(),
  unique (training_id, athlete_id)
);

-- 8. EVALUATIONS (valutazioni manuali; l'origine AI arriva in F5) --------
create table if not exists evaluations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  fondamentale text not null check (fondamentale in ('Battuta', 'Ricezione', 'Attacco', 'Muro', 'Difesa')),
  punteggio numeric(3,1) not null check (punteggio between 1 and 10),
  note text default '',
  valutatore uuid references auth.users on delete set null,
  origine text not null default 'manuale' check (origine in ('manuale', 'ai_approvata', 'ai_modificata')),
  data_valutazione timestamptz not null default now(),
  creato_il timestamptz not null default now()
);

-- 9. INDICI ------------------------------------------------------------
create index if not exists idx_team_members_team on team_members (team_id);
create index if not exists idx_team_members_user on team_members (user_id);
create index if not exists idx_athletes_team on athletes (team_id) where status = 'attiva';
create index if not exists idx_exercises_team on exercises (team_id);
create index if not exists idx_trainings_team_data on trainings (team_id, data desc);
create index if not exists idx_training_exercises_training on training_exercises (training_id);
create index if not exists idx_attendance_training on attendance (training_id);
create index if not exists idx_attendance_athlete on attendance (athlete_id);
create index if not exists idx_rpe_training on rpe (training_id);
create index if not exists idx_evaluations_athlete on evaluations (athlete_id, fondamentale, data_valutazione desc);

-- 10. ROW LEVEL SECURITY --------------------------------------------------
alter table teams enable row level security;
alter table team_members enable row level security;
alter table athletes enable row level security;
alter table exercises enable row level security;
alter table trainings enable row level security;
alter table training_exercises enable row level security;
alter table attendance enable row level security;
alter table rpe enable row level security;
alter table evaluations enable row level security;

-- teams: visibile solo a chi ne è membro; la creazione è aperta a chiunque
-- sia autenticato (diventa automaticamente "allenatore", vedi funzione più sotto).
drop policy if exists "teams_select_member" on teams;
create policy "teams_select_member" on teams for select using (is_team_member(id));
drop policy if exists "teams_insert_any_auth" on teams;
create policy "teams_insert_any_auth" on teams for insert with check (auth.uid() is not null);

drop policy if exists "team_members_select_same_team" on team_members;
create policy "team_members_select_same_team" on team_members for select using (is_team_member(team_id));
drop policy if exists "team_members_insert_coach" on team_members;
create policy "team_members_insert_coach" on team_members for insert with check (is_team_coach(team_id) or user_id = auth.uid());
drop policy if exists "team_members_update_coach" on team_members;
create policy "team_members_update_coach" on team_members for update using (is_team_coach(team_id));
drop policy if exists "team_members_delete_coach" on team_members;
create policy "team_members_delete_coach" on team_members for delete using (is_team_coach(team_id));

-- Pattern comune per tutte le tabelle di dominio: lettura a ogni membro
-- del team, scrittura riservata ad allenatore/vice-allenatore (§0 Auth.gs
-- del vecchio modello: RUOLI.ALLENATORE/VICE_ALLENATORE). Le atlete (se in
-- futuro avranno un login proprio) restano in sola lettura sui propri dati:
-- non è un downgrade di funzionalità, la webapp GAS non lo prevedeva affatto.
do $$
declare
  t text;
begin
  foreach t in array array['athletes', 'exercises', 'trainings', 'training_exercises', 'attendance', 'rpe', 'evaluations']
  loop
    execute format('drop policy if exists "%1$s_select_member" on %1$s', t);
    execute format('drop policy if exists "%1$s_write_coach" on %1$s', t);
  end loop;
end $$;

create policy "athletes_select_member" on athletes for select using (is_team_member(team_id));
create policy "athletes_write_coach" on athletes for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

create policy "exercises_select_member" on exercises for select using (is_team_member(team_id));
create policy "exercises_write_coach" on exercises for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

create policy "trainings_select_member" on trainings for select using (is_team_member(team_id));
create policy "trainings_write_coach" on trainings for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

create policy "training_exercises_select_member" on training_exercises for select using (
  is_team_member((select team_id from trainings where id = training_id))
);
create policy "training_exercises_write_coach" on training_exercises for all using (
  is_team_coach((select team_id from trainings where id = training_id))
) with check (
  is_team_coach((select team_id from trainings where id = training_id))
);

create policy "attendance_select_member" on attendance for select using (
  is_team_member((select team_id from trainings where id = training_id))
);
create policy "attendance_write_coach" on attendance for all using (
  is_team_coach((select team_id from trainings where id = training_id))
) with check (
  is_team_coach((select team_id from trainings where id = training_id))
);

create policy "rpe_select_member" on rpe for select using (
  is_team_member((select team_id from trainings where id = training_id))
);
create policy "rpe_write_coach" on rpe for all using (
  is_team_coach((select team_id from trainings where id = training_id))
) with check (
  is_team_coach((select team_id from trainings where id = training_id))
);

create policy "evaluations_select_member" on evaluations for select using (is_team_member(team_id));
create policy "evaluations_write_coach" on evaluations for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

-- 11. RPC "crea_team_e_diventa_allenatore" ---------------------------------
-- Wrapper transazionale usato solo al primo setup (equivalente di install()):
-- crea il team e registra chi lo crea come allenatore in un solo passaggio.
create or replace function crea_team_e_diventa_allenatore(p_nome text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  insert into teams (nome, creato_da) values (p_nome, auth.uid()) returning id into v_team_id;
  insert into team_members (team_id, user_id, ruolo) values (v_team_id, auth.uid(), 'allenatore');
  return v_team_id;
end;
$$;

-- ============================================================
-- 0001b — Inviti membri squadra
-- Addendum a F1 (non una fase a sé): risponde alla necessità di più
-- allenatori/vice-allenatori sullo stesso team senza dover coordinare
-- manualmente chi "crea" cosa. Nome "0001b" apposta (non 0003/0004,
-- riservati a F3/F4 nella roadmap) per restare ordinato subito dopo
-- 0001_f1_anagrafica.sql nel confronto lessicografico dei nomi file.
--
-- Flusso: un allenatore invita un'email dall'app → quando quella
-- persona fa login con Google per la prima volta, il client chiama
-- accetta_inviti_pendenti() PRIMA di controllare se ha un team: se
-- c'è un invito che corrisponde alla sua email, entra automaticamente
-- nel team con il ruolo previsto, invece di finire nella schermata
-- "crea la tua prima squadra". Zero coordinamento manuale oltre
-- all'invito iniziale.
-- ============================================================

create table if not exists team_invites (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  email text not null,
  ruolo text not null check (ruolo in ('allenatore', 'vice_allenatore')),
  creato_da uuid references auth.users on delete set null,
  creato_il timestamptz not null default now(),
  usato_il timestamptz
);

-- Un solo invito "attivo" (non ancora usato) per team+email: se un
-- allenatore invita di nuovo la stessa email, ripristina il caso
-- rimuovendo/aggiornando l'invito precedente invece di duplicarlo.
create unique index if not exists idx_team_invites_attivo
  on team_invites (team_id, lower(email)) where (usato_il is null);

create index if not exists idx_team_invites_email on team_invites (lower(email)) where (usato_il is null);

alter table team_invites enable row level security;

drop policy if exists "team_invites_select_coach" on team_invites;
create policy "team_invites_select_coach" on team_invites for select using (is_team_coach(team_id));
drop policy if exists "team_invites_insert_coach" on team_invites;
create policy "team_invites_insert_coach" on team_invites for insert with check (is_team_coach(team_id));
drop policy if exists "team_invites_delete_coach" on team_invites;
create policy "team_invites_delete_coach" on team_invites for delete using (is_team_coach(team_id));
-- Nessuna policy update per il client: l'unico modo di marcare un
-- invito come usato è accetta_inviti_pendenti() qui sotto (security
-- definer), per evitare che chiunque possa "auto-accettarsi" un invito
-- altrui manipolando la riga direttamente.

-- Invita un'email a unirsi al team con un ruolo. Se esisteva già un
-- invito attivo per la stessa coppia team/email, lo sostituisce
-- (idempotente lato utilizzo: rimandare l'invito "aggiorna" il ruolo).
create or replace function invita_membro(p_team_id uuid, p_email text, p_ruolo text)
returns uuid
language plpgsql
security definer
as $$
declare
  v_invito_id uuid;
begin
  if not is_team_coach(p_team_id) then
    raise exception 'Permesso negato';
  end if;
  if p_ruolo not in ('allenatore', 'vice_allenatore') then
    raise exception 'Ruolo non valido: %', p_ruolo;
  end if;

  delete from team_invites where team_id = p_team_id and lower(email) = lower(p_email) and usato_il is null;

  insert into team_invites (team_id, email, ruolo, creato_da)
  values (p_team_id, lower(p_email), p_ruolo, auth.uid())
  returning id into v_invito_id;

  return v_invito_id;
end;
$$;

-- Da chiamare subito dopo il login, prima di controllare l'appartenenza
-- a un team: se l'email dell'utente corrente ha un invito pendente, lo
-- accetta ed entra nel team. Ritorna il team_id a cui si è unito, o
-- null se non c'era nessun invito in attesa.
create or replace function accetta_inviti_pendenti()
returns uuid
language plpgsql
security definer
as $$
declare
  v_email text;
  v_invito record;
begin
  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return null;
  end if;

  select * into v_invito from team_invites
    where lower(email) = lower(v_email) and usato_il is null
    order by creato_il asc
    limit 1;

  if v_invito is null then
    return null;
  end if;

  insert into team_members (team_id, user_id, ruolo)
  values (v_invito.team_id, auth.uid(), v_invito.ruolo)
  on conflict (team_id, user_id) do nothing;

  update team_invites set usato_il = now() where id = v_invito.id;

  return v_invito.team_id;
end;
$$;

-- ============================================================
-- 0001c — Ruoli estesi e privacy dei dati personali
-- Addendum a F1, come 0001b. Nome "0001c" per restare ordinato subito
-- dopo 0001b_inviti_team.sql nel confronto lessicografico dei file.
--
-- Aggiunge due ruoli mancanti in team_members:
--   - "presidente": sola lettura su tutto, nessuna scrittura da nessuna
--     parte (nessuna policy "for all", solo "for select").
--   - "atleta": collegata a UNA riga specifica di athletes (atleta_id
--     obbligatorio per questo ruolo). Vede il proprio rendimento
--     (valutazioni/rpe/presenze), MAI quello delle compagne, più
--     l'andamento aggregato di squadra (mai scomposto per singola atleta
--     diversa da sé) tramite la funzione andamento_squadra_valutazioni.
--     Può aggiornare solo i propri dati di contatto, mai i campi
--     assegnati dall'allenatore (ruolo_campo, numero_maglia, status).
--
-- "vice_allenatore" resta alla pari di "allenatore" in tutto: nessuna
-- policy va toccata per lui, sono già unificati in is_team_coach().
-- ============================================================

-- 1. Amplia i vincoli sul ruolo ------------------------------------------
alter table team_members drop constraint if exists team_members_ruolo_check;
alter table team_members add constraint team_members_ruolo_check
  check (ruolo in ('allenatore', 'vice_allenatore', 'presidente', 'atleta'));

-- Un membro con ruolo "atleta" DEVE essere collegato a una riga athletes;
-- gli altri ruoli non hanno questo vincolo (atleta_id resta opzionale/nullo).
alter table team_members drop constraint if exists team_members_atleta_id_obbligatorio;
alter table team_members add constraint team_members_atleta_id_obbligatorio
  check (ruolo <> 'atleta' or atleta_id is not null);

alter table team_invites drop constraint if exists team_invites_ruolo_check;
alter table team_invites add constraint team_invites_ruolo_check
  check (ruolo in ('allenatore', 'vice_allenatore', 'presidente', 'atleta'));

alter table team_invites add column if not exists atleta_id uuid references athletes on delete cascade;
alter table team_invites drop constraint if exists team_invites_atleta_id_obbligatorio;
alter table team_invites add constraint team_invites_atleta_id_obbligatorio
  check (ruolo <> 'atleta' or atleta_id is not null);

-- 2. Funzioni helper -------------------------------------------------------
create or replace function is_team_presidente(p_team_id uuid)
returns boolean language sql stable as $$
  select exists (
    select 1 from team_members where team_id = p_team_id and user_id = auth.uid() and ruolo = 'presidente'
  );
$$;

-- "Staff con visibilità piena" = chi deve vedere i dati di TUTTE le
-- atlete, in scrittura (coach) o sola lettura (presidente).
create or replace function is_team_staff_visione_piena(p_team_id uuid)
returns boolean language sql stable as $$
  select is_team_coach(p_team_id) or is_team_presidente(p_team_id);
$$;

-- Ritorna l'athlete_id collegato all'utente corrente in quel team, se e
-- solo se il suo ruolo lì è "atleta" — altrimenti null.
create or replace function mio_atleta_id(p_team_id uuid)
returns uuid language sql stable as $$
  select atleta_id from team_members
  where team_id = p_team_id and user_id = auth.uid() and ruolo = 'atleta';
$$;

-- 3. RLS: dati personali (valutazioni, rpe, presenze, baseline) -----------
-- Prima erano leggibili da "is_team_member" (chiunque nel team, comprese
-- le altre atlete): li stringiamo a "staff con visione piena" + "solo il
-- proprio athlete_id" per chi è loggata come atleta.

drop policy if exists "evaluations_select_member" on evaluations;
drop policy if exists "evaluations_select_ristretta" on evaluations;
create policy "evaluations_select_ristretta" on evaluations for select using (
  is_team_staff_visione_piena(team_id) or athlete_id = mio_atleta_id(team_id)
);

-- NOTA: la policy su season_baselines NON sta qui — la tabella non
-- esiste ancora a questo punto dello script (viene creata in
-- 0002_f2_stagioni.sql, dopo questo file). È in
-- 0002b_season_baselines_ristretta.sql, eseguita subito dopo. Su un
-- database vuoto, referenziarla qui avrebbe fatto fallire l'intero
-- script con "relation season_baselines does not exist" prima ancora
-- di arrivare alle sezioni successive — bug bloccante reale, corretto.

drop policy if exists "attendance_select_member" on attendance;
drop policy if exists "attendance_select_ristretta" on attendance;
create policy "attendance_select_ristretta" on attendance for select using (
  is_team_staff_visione_piena((select team_id from trainings where id = training_id))
  or athlete_id = mio_atleta_id((select team_id from trainings where id = training_id))
);

drop policy if exists "rpe_select_member" on rpe;
drop policy if exists "rpe_select_ristretta" on rpe;
create policy "rpe_select_ristretta" on rpe for select using (
  is_team_staff_visione_piena((select team_id from trainings where id = training_id))
  or athlete_id = mio_atleta_id((select team_id from trainings where id = training_id))
);

-- evaluation_proposals resta riservata allo staff (sono bozze di lavoro
-- dell'allenatore, non un dato personale dell'atleta da mostrarle prima
-- che diventi una valutazione vera).

-- 4. RLS: anagrafica atlete, esercizi, allenamenti — restano leggibili a
-- tutto il team (roster, calendario, catalogo esercizi non sono dati
-- "personali" nello stesso senso), nessuna modifica qui.

-- 5. Contatti personali dell'atleta ----------------------------------------
-- Campi che l'atleta PUÒ modificare da sé; tutto il resto di "athletes"
-- (nome, cognome, ruolo_campo, numero_maglia, status) resta modificabile
-- solo dall'allenatore, invariato (nessuna nuova policy UPDATE sul
-- client: l'unica via di scrittura per l'atleta è la funzione qui sotto).
alter table athletes add column if not exists telefono text;
alter table athletes add column if not exists email_contatto text;
alter table athletes add column if not exists note_personali text;

create or replace function aggiorna_mio_contatto(p_team_id uuid, p_telefono text, p_email_contatto text, p_note_personali text)
returns void
language plpgsql
security definer
as $$
declare
  v_atleta_id uuid;
begin
  v_atleta_id := mio_atleta_id(p_team_id);
  if v_atleta_id is null then
    raise exception 'Nessuna scheda atleta collegata al tuo account in questo team';
  end if;

  update athletes
  set telefono = p_telefono, email_contatto = p_email_contatto, note_personali = p_note_personali
  where id = v_atleta_id;
end;
$$;

-- 6. Andamento squadra aggregato — visibile a chiunque sia nel team
-- (comprese le atlete), ma MAI scomposto per singola compagna: solo
-- medie per fondamentale/mese su tutta la squadra.
create or replace function andamento_squadra_valutazioni(p_team_id uuid)
returns table(fondamentale text, mese date, media numeric, numero_valutazioni integer)
language plpgsql
stable
security definer
as $$
begin
  if not is_team_member(p_team_id) then
    raise exception 'Permesso negato';
  end if;

  return query
    select e.fondamentale, date_trunc('month', e.data_valutazione)::date as mese,
           round(avg(e.punteggio), 2) as media, count(*)::integer as numero_valutazioni
    from evaluations e
    where e.team_id = p_team_id
    group by e.fondamentale, mese
    order by mese, e.fondamentale;
end;
$$;

-- 7. invita_membro esteso per il ruolo "atleta" ---------------------------
-- IMPORTANTE: la versione precedente (0001b) aveva 3 parametri; questa ne
-- ha 4. In Postgres, CREATE OR REPLACE con una lista di parametri diversa
-- non sostituisce la funzione: ne crea una SECONDA, sovraccaricata. Senza
-- il DROP esplicito qui sotto, il database si ritroverebbe con due
-- funzioni "invita_membro" — la vecchia a 3 argomenti resterebbe
-- chiamabile e fuori sincrono con questa. Va rimossa a mano.
drop function if exists invita_membro(uuid, text, text);

create or replace function invita_membro(p_team_id uuid, p_email text, p_ruolo text, p_atleta_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invito_id uuid;
  v_email_normalizzata text;
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato';
  end if;
  if not is_team_coach(p_team_id) then
    raise exception 'Permesso negato';
  end if;

  v_email_normalizzata := lower(trim(p_email));
  if v_email_normalizzata = '' or v_email_normalizzata is null then
    raise exception 'Email non valida';
  end if;

  if p_ruolo not in ('allenatore', 'vice_allenatore', 'presidente', 'atleta') then
    raise exception 'Ruolo non valido: %', p_ruolo;
  end if;
  if p_ruolo = 'atleta' and p_atleta_id is null then
    raise exception 'Per il ruolo atleta è obbligatorio indicare a quale scheda anagrafica collegare l''invito';
  end if;
  if p_atleta_id is not null and not exists (select 1 from athletes where id = p_atleta_id and team_id = p_team_id) then
    raise exception 'Scheda atleta non trovata in questo team';
  end if;
  -- Una scheda atleta non può già essere collegata a un membro attivo di
  -- QUALUNQUE team (un conto è invitare la stessa persona una seconda
  -- volta prima che accetti — gestito sotto con il DELETE — un altro è
  -- collegare due account diversi alla stessa atleta).
  if p_ruolo = 'atleta' and exists (select 1 from team_members where atleta_id = p_atleta_id) then
    raise exception 'Questa scheda atleta è già collegata a un account esistente';
  end if;
  if exists (select 1 from team_members tm where tm.team_id = p_team_id and tm.user_id in (select id from auth.users where lower(email) = v_email_normalizzata)) then
    raise exception 'Questa email è già membro della squadra';
  end if;

  delete from team_invites where team_id = p_team_id and lower(email) = v_email_normalizzata and usato_il is null;

  insert into team_invites (team_id, email, ruolo, atleta_id, creato_da)
  values (p_team_id, v_email_normalizzata, p_ruolo, p_atleta_id, auth.uid())
  returning id into v_invito_id;

  return v_invito_id;
end;
$$;

create or replace function accetta_inviti_pendenti()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invito record;
begin
  if auth.uid() is null then
    return null;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return null;
  end if;

  -- FOR UPDATE SKIP LOCKED: se due richieste arrivassero nello stesso
  -- istante (es. doppio tap, o due tab aperte), solo una ottiene il
  -- lock e procede; l'altra salta la riga già bloccata invece di
  -- rischiare di leggere uno stato a metà o duplicare l'accettazione.
  select * into v_invito from team_invites
    where lower(email) = lower(v_email) and usato_il is null
    order by creato_il asc
    limit 1
    for update skip locked;

  if v_invito is null then
    return null;
  end if;

  insert into team_members (team_id, user_id, ruolo, atleta_id)
  values (v_invito.team_id, auth.uid(), v_invito.ruolo, v_invito.atleta_id)
  on conflict (team_id, user_id) do nothing;

  update team_invites set usato_il = now() where id = v_invito.id;

  return v_invito.team_id;
end;
$$;

-- ============================================================
-- 0001d — Fix ricorsione RLS sulle funzioni helper
--
-- is_team_member/is_team_coach/is_team_presidente/mio_atleta_id
-- interrogano "team_members" per decidere la visibilità di righe che
-- possono trovarsi proprio dentro "team_members" (o, tramite
-- l'embedding automatico di PostgREST, dentro "teams" quando lo si
-- legge "annidato" da una query su team_members, come fa
-- AuthContext.ricaricaTeam()). Senza SECURITY DEFINER, Postgres valuta
-- questa autoreferenza sotto le stesse policy RLS che sta cercando di
-- decidere — un pattern che Supabase stesso segnala come causa di
-- risultati incoerenti (righe che esistono ma non vengono restituite).
-- Rendendole SECURITY DEFINER, queste funzioni leggono team_members
-- "ai margini" della RLS (bypassandola solo per il proprio controllo di
-- appartenenza, che è tutto ciò che devono fare), eliminando
-- l'autoriferimento alla radice. `set search_path = public` è
-- l'accorgimento di sicurezza standard per ogni funzione
-- SECURITY DEFINER, per evitare che qualcuno le "dirotti" verso
-- tabelle omonime in altri schema.
-- ============================================================

create or replace function is_team_member(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
  );
$$;

create or replace function is_team_coach(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members
    where team_id = p_team_id and user_id = auth.uid()
      and ruolo in ('allenatore', 'vice_allenatore')
  );
$$;

create or replace function is_team_presidente(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from team_members where team_id = p_team_id and user_id = auth.uid() and ruolo = 'presidente'
  );
$$;

create or replace function is_team_staff_visione_piena(p_team_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select is_team_coach(p_team_id) or is_team_presidente(p_team_id);
$$;

create or replace function mio_atleta_id(p_team_id uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select atleta_id from team_members
  where team_id = p_team_id and user_id = auth.uid() and ruolo = 'atleta';
$$;

-- ============================================================
-- 0001e — Codice fiscale atlete (per deduplica import Excel)
--
-- Chiave di dedup nel wizard di import: se presente, il codice fiscale
-- (univoco per persona) evita di duplicare un'atleta già censita anche
-- se nome/cognome sono scritti in modo leggermente diverso nel file
-- caricato; il fallback (nome+cognome normalizzati) resta gestito lato
-- client, non richiede struttura dati aggiuntiva qui.
-- ============================================================

alter table athletes add column if not exists codice_fiscale text;

-- Case-insensitive: "RSSMRA80A01H501U" e "rssmra80a01h501u" devono
-- essere riconosciuti come la stessa persona.
create unique index if not exists idx_athletes_codice_fiscale
  on athletes (team_id, upper(codice_fiscale)) where codice_fiscale is not null;

-- ============================================================
-- F2 — Stagioni + baseline (equivalente di V2.5 in AIVolleyballCoach GAS)
-- Nessuna colonna toccata su evaluations: l'appartenenza di una
-- valutazione a una stagione resta calcolata per intervallo di date,
-- esattamente come in storicoStagionale() (Seasons.gs originale) —
-- stessa scelta di design, portata qui pari pari.
-- ============================================================

create table if not exists seasons (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  nome text not null,
  stato text not null default 'pianificata' check (stato in ('pianificata', 'attiva', 'conclusa')),
  data_apertura date not null,
  data_chiusura date,
  creata_il timestamptz not null default now(),
  creata_da uuid references auth.users on delete set null
);

-- Una sola stagione "attiva" per team alla volta (era STAGIONE_ATTIVA_ID
-- nelle Script Properties: qui è un vincolo dichiarativo nel DB, niente
-- più stato nascosto fuori dalle tabelle che può disallinearsi).
create unique index if not exists idx_seasons_una_attiva_per_team
  on seasons (team_id) where (stato = 'attiva');

create table if not exists season_baselines (
  id uuid primary key default gen_random_uuid(),
  season_id uuid not null references seasons on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  fondamentale text not null check (fondamentale in ('Battuta', 'Ricezione', 'Attacco', 'Muro', 'Difesa')),
  valore_baseline numeric(3,1) not null,
  valutazione_id_riferimento uuid references evaluations on delete set null,
  creata_il timestamptz not null default now(),
  creata_da uuid references auth.users on delete set null,
  unique (season_id, athlete_id, fondamentale)
);

create index if not exists idx_seasons_team on seasons (team_id, data_apertura desc);
create index if not exists idx_season_baselines_season on season_baselines (season_id);
create index if not exists idx_season_baselines_athlete on season_baselines (athlete_id);

alter table seasons enable row level security;
alter table season_baselines enable row level security;

drop policy if exists "seasons_select_member" on seasons;
create policy "seasons_select_member" on seasons for select using (is_team_member(team_id));
drop policy if exists "seasons_write_coach" on seasons;
create policy "seasons_write_coach" on seasons for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

drop policy if exists "season_baselines_select_member" on season_baselines;
create policy "season_baselines_select_member" on season_baselines for select using (
  is_team_member((select team_id from seasons where id = season_id))
);
drop policy if exists "season_baselines_write_coach" on season_baselines;
create policy "season_baselines_write_coach" on season_baselines for all using (
  is_team_coach((select team_id from seasons where id = season_id))
) with check (
  is_team_coach((select team_id from seasons where id = season_id))
);

-- Attiva una stagione disattivando automaticamente le altre dello stesso
-- team (equivalente di attivaStagione() in Seasons.gs), in un'unica
-- transazione: evita la race condition possibile nella versione GAS tra
-- il ciclo di "disattiva le altre" e "attiva questa".
create or replace function attiva_stagione(p_season_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from seasons where id = p_season_id;
  if v_team_id is null then
    raise exception 'Stagione non trovata: %', p_season_id;
  end if;
  if not is_team_coach(v_team_id) then
    raise exception 'Permesso negato';
  end if;

  update seasons set stato = 'pianificata' where team_id = v_team_id and stato = 'attiva' and id <> p_season_id;
  update seasons set stato = 'attiva' where id = p_season_id;
end;
$$;

-- Conclude una stagione (la si può concludere anche se non era quella
-- "attiva", per correggere una stagione dimenticata aperta per errore).
-- CREATE OR REPLACE su una funzione è già idempotente di per sé, non
-- serve un DROP prima come per policy/vincoli.
create or replace function concludi_stagione(p_season_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from seasons where id = p_season_id;
  if v_team_id is null then raise exception 'Stagione non trovata: %', p_season_id; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update seasons set stato = 'conclusa', data_chiusura = coalesce(data_chiusura, current_date) where id = p_season_id;
end;
$$;

-- Genera la baseline di inizio stagione per tutte le atlete attive
-- (equivalente di generaBaselineStagione() in Seasons.gs). Idempotente:
-- salta atleta/fondamentale già presenti per quella stagione.
create or replace function genera_baseline_stagione(p_season_id uuid)
returns integer
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_data_apertura date;
  v_creati integer := 0;
  v_fondamentale text;
  v_riferimento record;
begin
  select team_id, data_apertura into v_team_id, v_data_apertura from seasons where id = p_season_id;
  if v_team_id is null then raise exception 'Stagione non trovata: %', p_season_id; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  for v_fondamentale in select unnest(array['Battuta','Ricezione','Attacco','Muro','Difesa'])
  loop
    for v_riferimento in
      select distinct on (e.athlete_id) e.athlete_id, e.id as valutazione_id, e.punteggio
      from evaluations e
      join athletes a on a.id = e.athlete_id
      where e.fondamentale = v_fondamentale
        and a.team_id = v_team_id
        and a.status = 'attiva'
        and e.data_valutazione::date <= v_data_apertura
        and not exists (
          select 1 from season_baselines sb
          where sb.season_id = p_season_id and sb.athlete_id = e.athlete_id and sb.fondamentale = v_fondamentale
        )
      order by e.athlete_id, e.data_valutazione desc
    loop
      insert into season_baselines (season_id, athlete_id, fondamentale, valore_baseline, valutazione_id_riferimento, creata_da)
      values (p_season_id, v_riferimento.athlete_id, v_fondamentale, v_riferimento.punteggio, v_riferimento.valutazione_id, auth.uid());
      v_creati := v_creati + 1;
    end loop;
  end loop;

  return v_creati;
end;
$$;

-- ============================================================
-- 0002b — RLS ristretta su season_baselines
--
-- Era dentro 0001c_ruoli_estesi.sql, ma quel file gira PRIMA di
-- 0002_f2_stagioni.sql (che crea "seasons" e "season_baselines") —
-- su un database vuoto lo script falliva subito con "relation
-- season_baselines does not exist". Spostata qui, che gira dopo.
-- ============================================================

drop policy if exists "season_baselines_select_member" on season_baselines;
drop policy if exists "season_baselines_select_ristretta" on season_baselines;
create policy "season_baselines_select_ristretta" on season_baselines for select using (
  is_team_staff_visione_piena((select team_id from seasons where id = season_id))
  or athlete_id = mio_atleta_id((select team_id from seasons where id = season_id))
  or is_superuser()
);

-- ============================================================
-- 0001f — mio_contesto_team(): caricamento atomico squadra+stagione
--
-- Causa reale del bug "l'atleta vede 'nessuna stagione aperta' anche
-- se ce n'è una attiva" (e sospetta concausa del bug "l'allenatore
-- vede sempre 'crea squadra'"): il client caricava squadra e stagione
-- attiva con DUE effetti React separati. Quello della stagione partiva
-- subito con team ancora nullo, impostando "nessuna stagione" come
-- stato iniziale — e per una manciata di millisecondi, tra il momento
-- in cui la squadra veniva risolta e il momento in cui l'effetto della
-- stagione si ri-eseguiva con il team corretto, l'app poteva leggere
-- quello stato iniziale "nessuna stagione" come se fosse definitivo e
-- reindirizzare l'utente alla schermata sbagliata.
--
-- Questa funzione elimina la possibilità stessa della race: un'unica
-- query atomica, SECURITY DEFINER (bypassa la RLS per il proprio
-- controllo di appartenenza, stesso principio già applicato a
-- is_team_member e affini), che il client chiama una volta sola e da
-- cui deriva SIA la squadra SIA la stagione attiva nello stesso
-- istante — non possono più disallinearsi tra loro perché non sono
-- più due richieste separate.
--
-- Multi-squadra: una riga per ogni squadra a cui l'utente appartiene,
-- ciascuna con la propria (eventuale) stagione attiva — il client
-- sceglie quale usare come "corrente" allo stesso modo di prima
-- (preferenza salvata, altrimenti la squadra più vecchia).
-- ============================================================

create or replace function mio_contesto_team()
returns table(
  team_id uuid,
  team_nome text,
  team_creato_il timestamptz,
  ruolo text,
  atleta_id uuid,
  stagione_id uuid,
  stagione_nome text,
  stagione_stato text,
  stagione_aperta boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select
      tm.team_id,
      t.nome,
      t.creato_il,
      tm.ruolo,
      tm.atleta_id,
      s.id,
      s.nome,
      s.stato,
      (s.stato = 'attiva')
    from team_members tm
    join teams t on t.id = tm.team_id
    left join seasons s on s.team_id = tm.team_id and s.stato = 'attiva'
    where tm.user_id = auth.uid()
    order by t.creato_il asc;
end;
$$;

-- ============================================================
-- F3 — Scouting live (partite, set, eventi)
-- Occupa lo slot "0003" lasciato libero fin dall'inizio della
-- migrazione. Sostituisce Scouting.gs + ScoutingAtleta.gs +
-- ScoutingAdvanced.gs con UN SOLO modello dati (match_events) a
-- granularità variabile — invece di tre moduli/tre statistiche quasi
-- identiche, come discusso nel piano di migrazione originale.
--
-- Principi applicati (dallo stesso piano):
-- - un evento = un tap su fondamentale + un tap su esito (max 2 tap);
-- - il punteggio del set si aggiorna DA SOLO via trigger quando si
--   registra un evento, e si corregge da solo quando si annulla
--   l'ultimo evento — chi usa l'app non gestisce mai il punteggio a
--   mano, è una conseguenza degli eventi registrati;
-- - "annulla ultima azione" è semplicemente cancellare l'ultima riga:
--   nessuna logica di compensazione lato client, la fa il trigger;
-- - privacy: gli scout sono personali per l'atleta (vede solo i propri,
--   mai quelli delle compagne), pienamente visibili a
--   allenatore/vice/presidente — stessa regola già in vigore per
--   valutazioni/presenze/RPE (0001c_ruoli_estesi.sql), qui replicata
--   1:1 sulle stesse funzioni helper.
-- ============================================================

create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  avversario text not null,
  data timestamptz not null,
  luogo text not null default 'casa' check (luogo in ('casa', 'trasferta')),
  stato text not null default 'programmata' check (stato in ('programmata', 'in_corso', 'conclusa')),
  set_vinti_noi integer not null default 0,
  set_vinti_avversario integer not null default 0,
  creato_il timestamptz not null default now(),
  creato_da uuid references auth.users on delete set null
);

create table if not exists match_sets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  numero_set integer not null,
  punti_noi integer not null default 0,
  punti_avversario integer not null default 0,
  concluso boolean not null default false,
  unique (match_id, numero_set)
);

-- Un solo motore per tutti e tre i vecchi moduli scouting: athlete_id
-- nullo = scouting "a livello squadra" (come il vecchio Scouting.gs V1),
-- valorizzato = scouting per singola atleta (come ScoutingAtleta V1.5).
-- Il livello "avanzato" (ScoutingAdvanced, zone/rotazioni) resta un
-- possibile ampliamento additivo futuro di questa stessa tabella
-- (nuove colonne nullable), non un modulo separato.
create table if not exists match_events (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references matches on delete cascade,
  set_id uuid not null references match_sets on delete cascade,
  skill text not null check (skill in ('Servizio', 'Ricezione', 'Attacco', 'Muro', 'Difesa', 'Punto_avversario')),
  esito text check (esito in ('punto', 'neutro', 'errore')),
  athlete_id uuid references athletes on delete set null,
  creato_il timestamptz not null default now(),
  creato_da uuid references auth.users on delete set null,
  -- "Punto_avversario" non ha bisogno di un esito (è già di per sé un
  -- punto avversario); ogni altro fondamentale lo richiede sempre.
  constraint match_events_esito_coerente check (
    (skill = 'Punto_avversario' and esito is null) or (skill <> 'Punto_avversario' and esito is not null)
  )
);

create index if not exists idx_matches_team on matches (team_id, data desc);
create index if not exists idx_match_sets_match on match_sets (match_id, numero_set);
create index if not exists idx_match_events_match on match_events (match_id, creato_il desc);
create index if not exists idx_match_events_athlete on match_events (athlete_id);

-- 1. Trigger: il punteggio del set è una CONSEGUENZA degli eventi, non
-- un dato inserito a mano — così "annulla ultima azione" è solo un
-- DELETE, mai una correzione manuale del punteggio.
create or replace function aggiorna_punteggio_da_evento()
returns trigger
language plpgsql
as $$
begin
  if TG_OP = 'INSERT' then
    if NEW.skill = 'Punto_avversario' or NEW.esito = 'errore' then
      update match_sets set punti_avversario = punti_avversario + 1 where id = NEW.set_id;
    elsif NEW.esito = 'punto' then
      update match_sets set punti_noi = punti_noi + 1 where id = NEW.set_id;
    end if;
    return NEW;
  elsif TG_OP = 'DELETE' then
    if OLD.skill = 'Punto_avversario' or OLD.esito = 'errore' then
      update match_sets set punti_avversario = greatest(0, punti_avversario - 1) where id = OLD.set_id;
    elsif OLD.esito = 'punto' then
      update match_sets set punti_noi = greatest(0, punti_noi - 1) where id = OLD.set_id;
    end if;
    return OLD;
  end if;
  return null;
end;
$$;

drop trigger if exists trg_aggiorna_punteggio on match_events;
create trigger trg_aggiorna_punteggio
  after insert or delete on match_events
  for each row execute function aggiorna_punteggio_da_evento();

-- 2. RLS -------------------------------------------------------------
alter table matches enable row level security;
alter table match_sets enable row level security;
alter table match_events enable row level security;

drop policy if exists "matches_select_member" on matches;
create policy "matches_select_member" on matches for select using (is_team_member(team_id));
drop policy if exists "matches_write_coach" on matches;
create policy "matches_write_coach" on matches for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

drop policy if exists "match_sets_select_member" on match_sets;
create policy "match_sets_select_member" on match_sets for select using (
  is_team_member((select team_id from matches where id = match_id))
);
drop policy if exists "match_sets_write_coach" on match_sets;
create policy "match_sets_write_coach" on match_sets for all using (
  is_team_coach((select team_id from matches where id = match_id))
) with check (
  is_team_coach((select team_id from matches where id = match_id))
);

-- Scouting: personale per l'atleta, pieno per lo staff — stessa regola
-- di evaluations/attendance/rpe. Nessuna policy insert/delete diretta
-- per il client: si passa sempre dalle RPC qui sotto (registra_evento/
-- annulla_ultimo_evento), che verificano il permesso esplicitamente —
-- così il trigger di punteggio scatta sempre in modo coerente e nessuno
-- può inserire un evento "silenzioso" scrivendo direttamente sulla
-- tabella.
drop policy if exists "match_events_select_ristretta" on match_events;
create policy "match_events_select_ristretta" on match_events for select using (
  is_team_staff_visione_piena((select team_id from matches where id = match_id))
  or athlete_id = mio_atleta_id((select team_id from matches where id = match_id))
);

-- 3. RPC di gestione partita ------------------------------------------

create or replace function crea_match(p_team_id uuid, p_avversario text, p_data timestamptz, p_luogo text default 'casa')
returns uuid
language plpgsql
security definer
as $$
declare
  v_match_id uuid;
begin
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  insert into matches (team_id, avversario, data, luogo, stato)
  values (p_team_id, p_avversario, p_data, p_luogo, 'in_corso')
  returning id into v_match_id;

  insert into match_sets (match_id, numero_set) values (v_match_id, 1);

  return v_match_id;
end;
$$;

create or replace function nuovo_set(p_match_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_prossimo_numero integer;
  v_set_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update match_sets set concluso = true where match_id = p_match_id and concluso = false;

  select coalesce(max(numero_set), 0) + 1 into v_prossimo_numero from match_sets where match_id = p_match_id;
  insert into match_sets (match_id, numero_set) values (p_match_id, v_prossimo_numero) returning id into v_set_id;

  return v_set_id;
end;
$$;

-- Un tap (skill) + un tap (esito) = una chiamata sola: il client li
-- unisce prima di chiamare questa funzione, non sono due round-trip.
create or replace function registra_evento(p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid default null)
returns uuid
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_evento_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  insert into match_events (match_id, set_id, skill, esito, athlete_id, creato_da)
  values (p_match_id, p_set_id, p_skill, p_esito, p_athlete_id, auth.uid())
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

-- "Annulla ultima azione": elimina l'evento più recente di QUESTA
-- partita (non solo di questo set, per coprire il caso raro di essersi
-- accorti dell'errore subito dopo aver cambiato set).
create or replace function annulla_ultimo_evento(p_match_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_evento_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  select id into v_evento_id from match_events where match_id = p_match_id order by creato_il desc limit 1;
  if v_evento_id is null then raise exception 'Nessun evento da annullare'; end if;

  delete from match_events where id = v_evento_id;
end;
$$;

create or replace function chiudi_match(p_match_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update match_sets set concluso = true where match_id = p_match_id and concluso = false;
  update matches set
    stato = 'conclusa',
    set_vinti_noi = (select count(*) from match_sets where match_id = p_match_id and punti_noi > punti_avversario),
    set_vinti_avversario = (select count(*) from match_sets where match_id = p_match_id and punti_avversario > punti_noi)
  where id = p_match_id;
end;
$$;

-- 4. Andamento squadra tra partite diverse — visibile a TUTTI (incluse
-- le atlete), mai scomposto per singola compagna: stesso principio già
-- applicato in andamento_squadra_valutazioni.
create or replace function andamento_squadra_partite(p_team_id uuid)
returns table(fondamentale text, partita date, avversario text, punti integer, errori integer)
language plpgsql
stable
security definer
as $$
begin
  if not is_team_member(p_team_id) then raise exception 'Permesso negato'; end if;

  return query
    select e.skill as fondamentale, m.data::date as partita, m.avversario,
           count(*) filter (where e.esito = 'punto')::integer as punti,
           count(*) filter (where e.esito = 'errore')::integer as errori
    from match_events e
    join matches m on m.id = e.match_id
    where m.team_id = p_team_id and e.skill <> 'Punto_avversario'
    group by e.skill, m.data, m.avversario
    order by m.data desc, e.skill;
end;
$$;

-- ============================================================
-- 0004 — Integrazione SportEasy (sync eventi calendario)
-- Occupa lo slot "0004" lasciato libero per F6. Sostituisce
-- SportEasySync.gs: importa SOLO eventi (allenamenti/partite) dal
-- calendario iCal della squadra, mai l'anagrafica atlete (come da
-- richiesta esplicita).
--
-- Design: la sincronizzazione vera (fetch HTTP + parsing ICS) vive
-- nell'Edge Function `sync-sporteasy`, che scrive qui con la
-- service_role key dopo aver verificato is_team_coach() — stesso
-- pattern già usato per ai-router. Qui in SQL c'è solo: dove si
-- salva l'URL del calendario, e come evitare eventi duplicati ad
-- ogni sincronizzazione (sporteasy_uid, l'identificativo univoco che
-- ogni evento ha già dentro il file .ics).
-- ============================================================

create table if not exists team_integrations (
  team_id uuid primary key references teams on delete cascade,
  sporteasy_ical_url text,
  ultima_sincronizzazione timestamptz,
  ultimo_esito text
);

alter table team_integrations enable row level security;
drop policy if exists "team_integrations_select_member" on team_integrations;
create policy "team_integrations_select_member" on team_integrations for select using (is_team_member(team_id));
drop policy if exists "team_integrations_write_coach" on team_integrations;
create policy "team_integrations_write_coach" on team_integrations for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

-- Dedup: un evento con lo stesso UID (dal file .ics) non viene mai
-- duplicato, anche sincronizzando cento volte — viene solo aggiornato
-- (titolo/data), mai lo stato che l'allenatore ha già cambiato in app
-- (vedi Edge Function: l'UPSERT non tocca mai "stato").
alter table trainings add column if not exists sporteasy_uid text;
create unique index if not exists idx_trainings_sporteasy_uid on trainings (team_id, sporteasy_uid) where sporteasy_uid is not null;

alter table matches add column if not exists sporteasy_uid text;
create unique index if not exists idx_matches_sporteasy_uid on matches (team_id, sporteasy_uid) where sporteasy_uid is not null;

create or replace function imposta_integrazione_sporteasy(p_team_id uuid, p_ical_url text)
returns void
language plpgsql
security definer
as $$
begin
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  insert into team_integrations (team_id, sporteasy_ical_url)
  values (p_team_id, p_ical_url)
  on conflict (team_id) do update set sporteasy_ical_url = excluded.sporteasy_ical_url;
end;
$$;

-- Un evento importato dal calendario nasce come partita "programmata"
-- SENZA set (non ha senso creare un set finché non si comincia a
-- scoutare davvero). avvia_match crea il set 1 e la porta "in_corso"
-- solo quando l'allenatore preme "Inizia scouting" il giorno stesso.
create or replace function avvia_match(p_match_id uuid)
returns uuid
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
  v_set_id uuid;
begin
  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  select id into v_set_id from match_sets where match_id = p_match_id and numero_set = 1;
  if v_set_id is null then
    insert into match_sets (match_id, numero_set) values (p_match_id, 1) returning id into v_set_id;
  end if;

  update matches set stato = 'in_corso' where id = p_match_id and stato = 'programmata';

  return v_set_id;
end;
$$;

-- ============================================================
-- F5 — Layer AI, manual-first (equivalente di V2+V7 in AIVolleyballCoach
-- GAS, qui riprogettato fin da subito come nella patch V7.1: un solo
-- flusso Valutazioni con AI come assist opzionale, mai un gate).
-- Numerata "0005" per lasciare 0003/0004 a Scouting live e Match
-- Analysis (fasi F3/F4, deliberatamente rimandate).
--
-- Le chiavi dei provider (Gemini/OpenRouter/Groq) NON vivono in nessuna
-- tabella qui: stanno solo come secret dell'Edge Function ai-router
-- (supabase/functions/ai-router), esattamente come leggiSegreto_() in
-- GAS non le metteva mai nel foglio Config. Qui sotto c'è solo la
-- configurazione "quali provider, in che ordine, con quale modello".
-- ============================================================

create table if not exists evaluation_proposals (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  fondamentale text not null check (fondamentale in ('Battuta', 'Ricezione', 'Attacco', 'Muro', 'Difesa')),
  valore_attuale numeric(3,1),
  valore_proposto numeric(3,1) not null,
  confidenza text not null default 'media' check (confidenza in ('bassa', 'media', 'alta')),
  motivazione text default '',
  provider_usato text,
  stato text not null default 'proposta' check (stato in ('proposta', 'approvata', 'modificata', 'rigettata')),
  valutazione_id uuid references evaluations on delete set null,
  creata_il timestamptz not null default now(),
  decisa_il timestamptz,
  decisa_da uuid references auth.users on delete set null
);

create index if not exists idx_evaluation_proposals_pendenti
  on evaluation_proposals (team_id, athlete_id, fondamentale) where (stato = 'proposta');

alter table evaluation_proposals enable row level security;
drop policy if exists "evaluation_proposals_select_member" on evaluation_proposals;
create policy "evaluation_proposals_select_member" on evaluation_proposals for select using (is_team_member(team_id));
drop policy if exists "evaluation_proposals_write_coach" on evaluation_proposals;
create policy "evaluation_proposals_write_coach" on evaluation_proposals for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

-- 2. AI_PROVIDERS_CONFIG --------------------------------------------------
-- Sostituisce il foglio "AiProviders", ma con un vincolo che nella
-- versione GAS non c'era: provider_code è vincolato a un CHECK, quindi
-- non può più esistere una riga fantasma "GEMINI2" (il problema risolto
-- a runtime con l'allow-list nella patch V7.1 qui è impedito a monte,
-- direttamente dal database).
create table if not exists ai_providers_config (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams on delete cascade, -- null = default globale
  provider_code text not null check (provider_code in ('GEMINI', 'OPENROUTER', 'GROQ')),
  enabled boolean not null default true,
  priority integer not null default 1,
  modello text,
  unique (team_id, provider_code)
);

-- Il seed dei 3 provider di default vive in 0005b_fix_ai_providers_unique.sql
-- (con WHERE NOT EXISTS invece di ON CONFLICT): un ON CONFLICT qui
-- punterebbe al vincolo "ai_providers_config_team_id_provider_code_key",
-- che 0005b elimina subito dopo per sostituirlo con due indici parziali
-- — alla riesecuzione dello script, quel vincolo non esiste più e
-- l'ON CONFLICT fallisce con "no unique or exclusion constraint
-- matching the ON CONFLICT specification".

alter table ai_providers_config enable row level security;
drop policy if exists "ai_providers_config_select_member" on ai_providers_config;
create policy "ai_providers_config_select_member" on ai_providers_config for select using (
  team_id is null or is_team_member(team_id)
);
drop policy if exists "ai_providers_config_write_coach" on ai_providers_config;
create policy "ai_providers_config_write_coach" on ai_providers_config for all using (
  team_id is not null and is_team_coach(team_id)
) with check (
  team_id is not null and is_team_coach(team_id)
);

-- 3. AI_CALL_LOG (rate limiting) -------------------------------------------
-- Sostituisce RateLimiter.gs (che contava le chiamate in una Script
-- Property al giorno). Qui è una riga per chiamata riuscita: più
-- verboso ma auditabile, e la quota si calcola con una query invece di
-- un contatore a parte che può disallinearsi.
create table if not exists ai_call_log (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  provider_usato text not null,
  creato_il timestamptz not null default now()
);

create index if not exists idx_ai_call_log_team_giorno on ai_call_log (team_id, creato_il desc);

alter table ai_call_log enable row level security;
drop policy if exists "ai_call_log_select_member" on ai_call_log;
create policy "ai_call_log_select_member" on ai_call_log for select using (is_team_member(team_id));
-- Nessuna policy di insert per i client: solo l'Edge Function (con la
-- service_role key, che salta la RLS) scrive qui, per evitare che un
-- client possa falsificare il proprio conteggio di chiamate residue.

-- 4. RPC di supporto per il client -----------------------------------------

-- Quota giornaliera residua per team (default 20/giorno, configurabile
-- in futuro per team se servirà — oggi è un valore fisso condiviso).
create or replace function ai_chiamate_residue_oggi(p_team_id uuid)
returns integer
language sql stable
as $$
  select greatest(0, 20 - count(*)::integer)
  from ai_call_log
  where team_id = p_team_id and creato_il >= date_trunc('day', now());
$$;

-- Applica la decisione dell'allenatore su una proposta: approvata così
-- com'è, o modificata con un valore diverso. In entrambi i casi crea la
-- valutazione reale e collega la proposta ad essa — dopo questa funzione,
-- una valutazione "nata dall'AI" è indistinguibile in query da una
-- manuale se non per la colonna origine (stesso principio di
-- EvaluationsAI.gs originale: approvaProposta/modificaProposta).
create or replace function decidi_proposta_valutazione(p_proposta_id uuid, p_valore_finale numeric, p_note text default '')
returns uuid
language plpgsql
security definer
as $$
declare
  v_proposta record;
  v_valutazione_id uuid;
  v_origine text;
begin
  select * into v_proposta from evaluation_proposals where id = p_proposta_id and stato = 'proposta';
  if v_proposta is null then
    raise exception 'Proposta non trovata o già decisa: %', p_proposta_id;
  end if;
  if not is_team_coach(v_proposta.team_id) then
    raise exception 'Permesso negato';
  end if;

  v_origine := case when p_valore_finale = v_proposta.valore_proposto then 'ai_approvata' else 'ai_modificata' end;

  insert into evaluations (team_id, athlete_id, fondamentale, punteggio, note, valutatore, origine)
  values (v_proposta.team_id, v_proposta.athlete_id, v_proposta.fondamentale, p_valore_finale, p_note, auth.uid(), v_origine)
  returning id into v_valutazione_id;

  update evaluation_proposals
  set stato = case when v_origine = 'ai_approvata' then 'approvata' else 'modificata' end,
      decisa_il = now(), decisa_da = auth.uid(), valutazione_id = v_valutazione_id
  where id = p_proposta_id;

  return v_valutazione_id;
end;
$$;

create or replace function rigetta_proposta_valutazione(p_proposta_id uuid)
returns void
language plpgsql
security definer
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from evaluation_proposals where id = p_proposta_id and stato = 'proposta';
  if v_team_id is null then raise exception 'Proposta non trovata o già decisa: %', p_proposta_id; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update evaluation_proposals set stato = 'rigettata', decisa_il = now(), decisa_da = auth.uid() where id = p_proposta_id;
end;
$$;

-- ============================================================
-- 0005b — Fix unicità ai_providers_config per righe globali
--
-- Il vincolo "unique (team_id, provider_code)" di 0005_f5_ai_layer.sql
-- non impedisce duplicati quando team_id è NULL (i default globali):
-- in SQL, due valori NULL non sono mai considerati uguali ai fini di un
-- vincolo UNIQUE. Effetto pratico: ogni riesecuzione di
-- setup_supabase.sql duplicava le 3 righe globali seminate all'inizio.
-- Sostituito con due indici parziali, uno per team specifici e uno per
-- i default globali, che coprono correttamente entrambi i casi.
-- ============================================================

alter table ai_providers_config drop constraint if exists ai_providers_config_team_id_provider_code_key;

-- Rimuove PRIMA eventuali duplicati globali già creati da riesecuzioni
-- precedenti del vecchio seed (tiene solo la riga più vecchia per
-- provider_code) — deve avvenire prima di creare l'indice univoco qui
-- sotto, altrimenti la CREATE UNIQUE INDEX fallisce proprio sui
-- duplicati che sta cercando di prevenire in futuro.
delete from ai_providers_config a
where a.team_id is null
  and a.id::text not in (
    select min(b.id::text) from ai_providers_config b where b.team_id is null group by b.provider_code
  );

-- Stessa pulizia preventiva anche per eventuali duplicati non globali
-- (per team specifico), per lo stesso motivo.
delete from ai_providers_config a
where a.team_id is not null
  and a.id::text not in (
    select min(b.id::text) from ai_providers_config b where b.team_id = a.team_id group by b.provider_code
  );

create unique index if not exists idx_ai_providers_config_team
  on ai_providers_config (team_id, provider_code) where team_id is not null;

create unique index if not exists idx_ai_providers_config_globale
  on ai_providers_config (provider_code) where team_id is null;

-- Riscritto con WHERE NOT EXISTS invece di ON CONFLICT: quest'ultimo
-- non si attiva sulle righe con team_id nullo per lo stesso motivo di
-- cui sopra, quindi il seed originale in 0005 duplicava ad ogni run.
insert into ai_providers_config (team_id, provider_code, enabled, priority, modello)
select null, x.provider_code, true, x.priority, x.modello
from (values
  ('GEMINI', 1, 'gemini-2.0-flash'),
  ('GROQ', 2, 'llama-3.3-70b-versatile'),
  ('OPENROUTER', 3, 'openrouter/free')
) as x(provider_code, priority, modello)
where not exists (
  select 1 from ai_providers_config existenti
  where existenti.team_id is null and existenti.provider_code = x.provider_code
);

-- ============================================================
-- 0006 — Super-amministratore globale
--
-- Un superuser non appartiene a un team: è registrato in app_admins e
-- vede/gestisce trasversalmente tutte le squadre. Pensato per un ruolo
-- di gestione tecnica della piattaforma (es. te), non per il normale
-- staff di una squadra — un allenatore/presidente restano scoperti
-- entro il proprio team con le regole già in vigore.
--
-- Applicato qui alle tabelle principali (teams, team_members, athletes,
-- evaluations, seasons, matches, match_events, ai_providers_config
-- globale). Le tabelle rimaste fuori da questa prima passata (exercises,
-- trainings, training_exercises, attendance, rpe, evaluation_proposals,
-- season_baselines, team_invites, team_integrations, ai_call_log)
-- seguono lo stesso identico pattern — un "or is_superuser()" aggiunto
-- alla USING della policy di select — da estendere quando serve
-- davvero vedere anche quei dati da superuser, non è stato fatto qui
-- solo per contenere la dimensione di questa migrazione.
-- ============================================================

create table if not exists app_admins (
  user_id uuid primary key references auth.users on delete cascade,
  aggiunto_il timestamptz not null default now()
);

alter table app_admins enable row level security;
-- Nessuna policy di select/insert per il client: solo un altro
-- superuser può leggerla, e comunque solo tramite is_superuser() che è
-- security definer (bypassa la RLS). L'unico modo per aggiungere un
-- nuovo superuser è dal SQL Editor di Supabase direttamente:
--   insert into app_admins (user_id) values ('uuid-utente');
-- Scelta intenzionale: promuovere qualcuno a superuser non deve essere
-- possibile dall'app stessa, nemmeno da un altro superuser via RPC.

create or replace function is_superuser()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from app_admins where user_id = auth.uid());
$$;

-- RPC usata dal client solo per sapere se mostrare le voci di menu da
-- superuser — non concede nulla di per sé, la vera protezione è nelle
-- policy RLS qui sotto.
create or replace function sono_superuser()
returns boolean
language sql stable
as $$
  select is_superuser();
$$;

-- Estende (mai sostituisce) le policy di select già esistenti.
drop policy if exists "teams_select_member" on teams;
create policy "teams_select_member" on teams for select using (is_team_member(id) or is_superuser());

drop policy if exists "team_members_select_same_team" on team_members;
create policy "team_members_select_same_team" on team_members for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "athletes_select_member" on athletes;
create policy "athletes_select_member" on athletes for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "evaluations_select_ristretta" on evaluations;
create policy "evaluations_select_ristretta" on evaluations for select using (
  is_team_staff_visione_piena(team_id) or athlete_id = mio_atleta_id(team_id) or is_superuser()
);

drop policy if exists "seasons_select_member" on seasons;
create policy "seasons_select_member" on seasons for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "matches_select_member" on matches;
create policy "matches_select_member" on matches for select using (is_team_member(team_id) or is_superuser());

drop policy if exists "match_events_select_ristretta" on match_events;
create policy "match_events_select_ristretta" on match_events for select using (
  is_team_staff_visione_piena((select team_id from matches where id = match_id))
  or athlete_id = mio_atleta_id((select team_id from matches where id = match_id))
  or is_superuser()
);

-- ai_providers_config: il superuser può gestire i default GLOBALI
-- (team_id is null) — le righe specifiche di un singolo team restano
-- decisione di quel team, il superuser non le tocca da qui.
drop policy if exists "ai_providers_config_write_coach" on ai_providers_config;
create policy "ai_providers_config_write_coach" on ai_providers_config for all using (
  (team_id is not null and is_team_coach(team_id)) or (team_id is null and is_superuser())
) with check (
  (team_id is not null and is_team_coach(team_id)) or (team_id is null and is_superuser())
);

-- ============================================================
-- 0007 — Hardening di sicurezza
--
-- Risponde a un audit di sicurezza sullo schema. Copre: search_path
-- mancante su varie funzioni SECURITY DEFINER, creazione di team
-- "orfani" (senza allenatore) ancora possibile via insert diretto,
-- consistenza cross-team non garantita solo da RLS, race condition in
-- registra_evento, quota AI non verificata per team, privilegi
-- EXECUTE non espliciti.
-- ============================================================

-- 1. search_path mancante su funzioni già corrette altrove -----------------
-- ALTER FUNCTION invece di riscriverle: nessun cambio di comportamento,
-- solo l'attributo di sicurezza mancante.
alter function crea_team_e_diventa_allenatore(text) set search_path = public;
alter function aggiorna_mio_contatto(uuid, text, text, text) set search_path = public;
alter function andamento_squadra_valutazioni(uuid) set search_path = public;
alter function attiva_stagione(uuid) set search_path = public;
alter function concludi_stagione(uuid) set search_path = public;
alter function genera_baseline_stagione(uuid) set search_path = public;
alter function crea_match(uuid, text, timestamptz, text) set search_path = public;
alter function nuovo_set(uuid) set search_path = public;
alter function annulla_ultimo_evento(uuid) set search_path = public;
alter function chiudi_match(uuid) set search_path = public;
alter function andamento_squadra_partite(uuid) set search_path = public;
alter function imposta_integrazione_sporteasy(uuid, text) set search_path = public;
alter function avvia_match(uuid) set search_path = public;
alter function decidi_proposta_valutazione(uuid, numeric, text) set search_path = public;
alter function rigetta_proposta_valutazione(uuid) set search_path = public;
-- registra_evento viene ridefinita per intero più sotto (nuovi controlli),
-- quindi il suo search_path si imposta lì direttamente, non qui.

-- 2. Blocca la creazione di team "orfani" -----------------------------------
-- Prima chiunque autenticato poteva fare un insert diretto su "teams"
-- senza passare da crea_team_e_diventa_allenatore(), creando una
-- squadra senza nessun allenatore collegato. La creazione ora passa
-- SOLO dalla RPC (che è SECURITY DEFINER e crea team+primo membro
-- nella stessa transazione).
drop policy if exists "teams_insert_any_auth" on teams;

create or replace function crea_team_e_diventa_allenatore(p_nome text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_nome_pulito text;
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato';
  end if;
  v_nome_pulito := trim(p_nome);
  if v_nome_pulito = '' or v_nome_pulito is null then
    raise exception 'Il nome della squadra non può essere vuoto';
  end if;

  insert into teams (nome, creato_da) values (v_nome_pulito, auth.uid()) returning id into v_team_id;
  insert into team_members (team_id, user_id, ruolo) values (v_team_id, auth.uid(), 'allenatore');
  return v_team_id;
end;
$$;

-- 3. registra_evento rafforzata ---------------------------------------------
-- Prima verificava solo "la partita esiste" + "sei coach del team". Non
-- verificava che il set appartenesse davvero a quella partita (si
-- poteva registrare un evento passando il set_id di UN'ALTRA partita),
-- né che l'atleta indicata appartenesse allo stesso team, né che la
-- partita non fosse già conclusa. Aggiunto anche un lock esplicito sul
-- set per serializzare inserimenti concorrenti sullo stesso set (due
-- tap quasi simultanei non devono poter corrompere il punteggio).
create or replace function registra_evento(p_match_id uuid, p_set_id uuid, p_skill text, p_esito text, p_athlete_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_stato_match text;
  v_evento_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Utente non autenticato';
  end if;

  select team_id, stato into v_team_id, v_stato_match from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;
  if v_stato_match = 'conclusa' then raise exception 'Partita già conclusa, non è più possibile registrare eventi'; end if;

  -- FOR UPDATE: blocca la riga del set per la durata della transazione,
  -- così due registrazioni quasi simultanee sullo stesso set si
  -- accodano invece di poter leggere lo stesso punteggio "vecchio" ed
  -- eseguire entrambe un incremento basato su un valore ormai superato.
  if not exists (select 1 from match_sets where id = p_set_id and match_id = p_match_id for update) then
    raise exception 'Il set indicato non appartiene a questa partita';
  end if;

  if p_athlete_id is not null and not exists (select 1 from athletes where id = p_athlete_id and team_id = v_team_id) then
    raise exception 'L''atleta indicata non appartiene a questa squadra';
  end if;

  insert into match_events (match_id, set_id, skill, esito, athlete_id, creato_da)
  values (p_match_id, p_set_id, p_skill, p_esito, p_athlete_id, auth.uid())
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

-- 4. Consistenza cross-team ---------------------------------------------
-- La RLS controlla CHI può vedere/scrivere una riga, ma non impedisce
-- da sola che una riga colleghi entità di team diversi (es. un'atleta
-- del team A assegnata per errore a un allenamento del team B). Un
-- trigger di validazione lo garantisce indipendentemente dalla RLS.

create or replace function verifica_stesso_team_training_athlete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_training uuid;
  v_team_athlete uuid;
begin
  select team_id into v_team_training from trainings where id = NEW.training_id;
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_training is distinct from v_team_athlete then
    raise exception 'L''atleta non appartiene alla stessa squadra dell''allenamento';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_attendance on attendance;
create trigger trg_verifica_team_attendance before insert or update on attendance
  for each row execute function verifica_stesso_team_training_athlete();

drop trigger if exists trg_verifica_team_rpe on rpe;
create trigger trg_verifica_team_rpe before insert or update on rpe
  for each row execute function verifica_stesso_team_training_athlete();

create or replace function verifica_stesso_team_match_athlete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_match uuid;
  v_team_athlete uuid;
begin
  if NEW.athlete_id is null then return NEW; end if;
  select team_id into v_team_match from matches where id = NEW.match_id;
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_match is distinct from v_team_athlete then
    raise exception 'L''atleta non appartiene alla squadra di questa partita';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_match_events on match_events;
create trigger trg_verifica_team_match_events before insert or update on match_events
  for each row execute function verifica_stesso_team_match_athlete();

create or replace function verifica_set_appartiene_a_match()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_del_set uuid;
begin
  select match_id into v_match_del_set from match_sets where id = NEW.set_id;
  if v_match_del_set is distinct from NEW.match_id then
    raise exception 'Il set indicato appartiene a un''altra partita';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_set_match on match_events;
create trigger trg_verifica_set_match before insert or update on match_events
  for each row execute function verifica_set_appartiene_a_match();

create or replace function verifica_stesso_team_evaluation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_athlete uuid;
begin
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_athlete is distinct from NEW.team_id then
    raise exception 'L''atleta non appartiene alla squadra indicata nella valutazione';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_evaluations on evaluations;
create trigger trg_verifica_team_evaluations before insert or update on evaluations
  for each row execute function verifica_stesso_team_evaluation();

create or replace function verifica_stesso_team_baseline()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_season uuid;
  v_team_athlete uuid;
begin
  select team_id into v_team_season from seasons where id = NEW.season_id;
  select team_id into v_team_athlete from athletes where id = NEW.athlete_id;
  if v_team_season is distinct from v_team_athlete then
    raise exception 'L''atleta non appartiene alla squadra di questa stagione';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_baseline on season_baselines;
create trigger trg_verifica_team_baseline before insert or update on season_baselines
  for each row execute function verifica_stesso_team_baseline();

create or replace function verifica_stesso_team_training_exercise()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_training uuid;
  v_team_exercise uuid;
begin
  select team_id into v_team_training from trainings where id = NEW.training_id;
  select team_id into v_team_exercise from exercises where id = NEW.exercise_id;
  if v_team_training is distinct from v_team_exercise then
    raise exception 'L''esercizio non appartiene alla stessa squadra dell''allenamento';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_training_exercises on training_exercises;
create trigger trg_verifica_team_training_exercises before insert or update on training_exercises
  for each row execute function verifica_stesso_team_training_exercise();

-- team_invites.atleta_id vs team dell'invito: già verificato dentro
-- invita_membro() (raise exception se la scheda non è dello stesso
-- team), non serve un trigger duplicato — l'unico punto di scrittura
-- passa da lì.

-- team_members.atleta_id vs athletes.team_id: già verificato dentro
-- invita_membro()/accetta_inviti_pendenti() allo stesso modo; aggiunto
-- comunque un trigger come rete di sicurezza in caso di scritture
-- future che non passino da quelle RPC.
create or replace function verifica_stesso_team_member_atleta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_atleta uuid;
begin
  if NEW.atleta_id is null then return NEW; end if;
  select team_id into v_team_atleta from athletes where id = NEW.atleta_id;
  if v_team_atleta is distinct from NEW.team_id then
    raise exception 'La scheda atleta collegata non appartiene a questa squadra';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_verifica_team_member_atleta on team_members;
create trigger trg_verifica_team_member_atleta before insert or update on team_members
  for each row execute function verifica_stesso_team_member_atleta();

-- 5. Quota AI verificata per team -------------------------------------------
-- Prima chiunque autenticato poteva interrogare la quota residua di
-- QUALUNQUE team passando un team_id a piacere: la funzione calcolava
-- comunque il valore corretto, ma un utente estraneo poteva comunque
-- "sbirciare" quante chiamate AI ha fatto un team a cui non appartiene.
create or replace function ai_chiamate_residue_oggi(p_team_id uuid)
returns integer
language sql stable
security definer
set search_path = public
as $$
  select case when is_team_member(p_team_id) then
    greatest(0, 20 - (select count(*)::integer from ai_call_log where team_id = p_team_id and creato_il >= date_trunc('day', now())))
  else 0 end;
$$;

-- 6. Privilegi EXECUTE espliciti ---------------------------------------------
-- Le funzioni helper (is_team_member e affini) servono SOLO dentro le
-- policy RLS e devono restare eseguibili da "authenticated" (altrimenti
-- le policy stesse smetterebbero di funzionare), ma non hanno motivo di
-- essere chiamabili da "anon". Le RPC applicative sono già protette dai
-- controlli interni (is_team_coach, auth.uid() is null, ecc.): qui
-- rendiamo esplicito anche a livello di privilegi che "anon" non deve
-- poterle nemmeno invocare.
revoke execute on function is_team_member(uuid) from anon;
revoke execute on function is_team_coach(uuid) from anon;
revoke execute on function is_team_presidente(uuid) from anon;
revoke execute on function is_team_staff_visione_piena(uuid) from anon;
revoke execute on function mio_atleta_id(uuid) from anon;
revoke execute on function is_superuser() from anon;
revoke execute on function sono_superuser() from anon;

revoke execute on function crea_team_e_diventa_allenatore(text) from anon;
revoke execute on function invita_membro(uuid, text, text, uuid) from anon;
revoke execute on function accetta_inviti_pendenti() from anon;
revoke execute on function aggiorna_mio_contatto(uuid, text, text, text) from anon;
revoke execute on function decidi_proposta_valutazione(uuid, numeric, text) from anon;
revoke execute on function rigetta_proposta_valutazione(uuid) from anon;
revoke execute on function genera_baseline_stagione(uuid) from anon;
revoke execute on function attiva_stagione(uuid) from anon;
revoke execute on function concludi_stagione(uuid) from anon;
revoke execute on function crea_match(uuid, text, timestamptz, text) from anon;
revoke execute on function nuovo_set(uuid) from anon;
revoke execute on function registra_evento(uuid, uuid, text, text, uuid) from anon;
revoke execute on function annulla_ultimo_evento(uuid) from anon;
revoke execute on function chiudi_match(uuid) from anon;
revoke execute on function avvia_match(uuid) from anon;
revoke execute on function imposta_integrazione_sporteasy(uuid, text) from anon;
revoke execute on function andamento_squadra_valutazioni(uuid) from anon;
revoke execute on function andamento_squadra_partite(uuid) from anon;
revoke execute on function ai_chiamate_residue_oggi(uuid) from anon;

-- Concessione esplicita ad "authenticated": Postgres di default concede
-- EXECUTE a PUBLIC su ogni nuova funzione, quindi tecnicamente
-- funzionerebbe comunque — ma essere espliciti qui significa che se in
-- futuro qualcuno cambia i privilegi di default del database,
-- l'applicazione non smette di funzionare in silenzio.
grant execute on function is_team_member(uuid) to authenticated;
grant execute on function is_team_coach(uuid) to authenticated;
grant execute on function is_team_presidente(uuid) to authenticated;
grant execute on function is_team_staff_visione_piena(uuid) to authenticated;
grant execute on function mio_atleta_id(uuid) to authenticated;
grant execute on function is_superuser() to authenticated;
grant execute on function sono_superuser() to authenticated;
grant execute on function crea_team_e_diventa_allenatore(text) to authenticated;
grant execute on function invita_membro(uuid, text, text, uuid) to authenticated;
grant execute on function accetta_inviti_pendenti() to authenticated;
grant execute on function aggiorna_mio_contatto(uuid, text, text, text) to authenticated;
grant execute on function decidi_proposta_valutazione(uuid, numeric, text) to authenticated;
grant execute on function rigetta_proposta_valutazione(uuid) to authenticated;
grant execute on function genera_baseline_stagione(uuid) to authenticated;
grant execute on function attiva_stagione(uuid) to authenticated;
grant execute on function concludi_stagione(uuid) to authenticated;
grant execute on function crea_match(uuid, text, timestamptz, text) to authenticated;
grant execute on function nuovo_set(uuid) to authenticated;
grant execute on function registra_evento(uuid, uuid, text, text, uuid) to authenticated;
grant execute on function annulla_ultimo_evento(uuid) to authenticated;
grant execute on function chiudi_match(uuid) to authenticated;
grant execute on function avvia_match(uuid) to authenticated;
grant execute on function imposta_integrazione_sporteasy(uuid, text) to authenticated;
grant execute on function andamento_squadra_valutazioni(uuid) to authenticated;
grant execute on function andamento_squadra_partite(uuid) to authenticated;
grant execute on function ai_chiamate_residue_oggi(uuid) to authenticated;

-- 7. Indici mancanti dall'audit ----------------------------------------------
create index if not exists idx_team_members_team_user on team_members (team_id, user_id);
create index if not exists idx_team_members_user_team on team_members (user_id, team_id);
create index if not exists idx_evaluations_team_athlete on evaluations (team_id, athlete_id);
-- idx_seasons_team_lookup e idx_matches_team_lookup NON aggiunti: sarebbero
-- ridondanti rispetto agli indici compositi già esistenti
-- idx_seasons_team (team_id, data_apertura) e idx_matches_team (team_id,
-- data) — un indice composito copre già le ricerche sul solo team_id.
create index if not exists idx_match_events_match_set_creato on match_events (match_id, set_id, creato_il desc);
create index if not exists idx_team_invites_email_lower on team_invites (lower(email));
-- idx_ai_call_log_team_creato NON aggiunto: ridondante rispetto a
-- idx_ai_call_log_team_giorno (team_id, creato_il desc) già esistente —
-- un B-tree si legge in entrambe le direzioni, non serve la versione
-- ascendente oltre a quella discendente sulle stesse colonne.


