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
