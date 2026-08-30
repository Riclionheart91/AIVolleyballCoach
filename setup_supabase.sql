-- ============================================================
-- SETUP COMPLETO — AI Volleyball Coach (idempotente)
-- ============================================================

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
  foreach t in array array['athletes', 'exercises', 'trainings', 'attendance', 'rpe', 'evaluations']
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
create policy "evaluations_select_ristretta" on evaluations for select using (
  is_team_staff_visione_piena(team_id) or athlete_id = mio_atleta_id(team_id)
);

drop policy if exists "season_baselines_select_member" on season_baselines;
create policy "season_baselines_select_ristretta" on season_baselines for select using (
  is_team_staff_visione_piena((select team_id from seasons where id = season_id))
  or athlete_id = mio_atleta_id((select team_id from seasons where id = season_id))
);

drop policy if exists "attendance_select_member" on attendance;
create policy "attendance_select_ristretta" on attendance for select using (
  is_team_staff_visione_piena((select team_id from trainings where id = training_id))
  or athlete_id = mio_atleta_id((select team_id from trainings where id = training_id))
);

drop policy if exists "rpe_select_member" on rpe;
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

-- 7. invita_membro esteso per il ruolo "atleta" (deve indicare quale
-- scheda anagrafica collegare) e accetta_inviti_pendenti aggiornato di
-- conseguenza.
create or replace function invita_membro(p_team_id uuid, p_email text, p_ruolo text, p_atleta_id uuid default null)
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
  if p_ruolo not in ('allenatore', 'vice_allenatore', 'presidente', 'atleta') then
    raise exception 'Ruolo non valido: %', p_ruolo;
  end if;
  if p_ruolo = 'atleta' and p_atleta_id is null then
    raise exception 'Per il ruolo atleta è obbligatorio indicare a quale scheda anagrafica collegare l''invito';
  end if;
  if p_atleta_id is not null and not exists (select 1 from athletes where id = p_atleta_id and team_id = p_team_id) then
    raise exception 'Scheda atleta non trovata in questo team';
  end if;

  delete from team_invites where team_id = p_team_id and lower(email) = lower(p_email) and usato_il is null;

  insert into team_invites (team_id, email, ruolo, atleta_id, creato_da)
  values (p_team_id, lower(p_email), p_ruolo, p_atleta_id, auth.uid())
  returning id into v_invito_id;

  return v_invito_id;
end;
$$;

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

  insert into team_members (team_id, user_id, ruolo, atleta_id)
  values (v_invito.team_id, auth.uid(), v_invito.ruolo, v_invito.atleta_id)
  on conflict (team_id, user_id) do nothing;

  update team_invites set usato_il = now() where id = v_invito.id;

  return v_invito.team_id;
end;
$$;

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

insert into ai_providers_config (team_id, provider_code, enabled, priority, modello) values
  (null, 'GEMINI', true, 1, 'gemini-2.0-flash'),
  (null, 'GROQ', true, 2, 'llama-3.3-70b-versatile'),
  (null, 'OPENROUTER', true, 3, 'openrouter/free')
on conflict (team_id, provider_code) do nothing;

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

