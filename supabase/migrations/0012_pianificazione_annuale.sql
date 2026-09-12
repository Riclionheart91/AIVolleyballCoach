-- ============================================================
-- 0012 — Pianificazione annuale (gestione cicli) + centro notifiche
--
-- NOTA DI SCOPO: "aggiornamento automatico mensile o ad ogni modifica
-- di valutazione" qui è implementato in modo REATTIVO, non con un
-- vero cron/job in background: quando l'allenatore apre la sezione
-- Pianificazione in Impostazioni, l'app controlla se sono passati 30+
-- giorni dall'ultima proposta o se ci sono valutazioni più recenti
-- dell'ultima proposta, e in tal caso propone di generarne una nuova.
-- Un vero sistema schedulato (Supabase Cron + Edge Function) è
-- possibile ma richiede una configurazione lato progetto Supabase che
-- va oltre queste migrazioni SQL — se lo vuoi, è un passo successivo.
--
-- Stesso principio per il "centro notifiche": qui è un elenco
-- calcolato al momento da più fonti (certificati medici in scadenza,
-- inviti pendenti, proposte di valutazione, suggerimenti di
-- aggiornamento piano) — non sono notifiche push del sistema
-- operativo, che richiederebbero token Expo Push e un server che le
-- invii, infrastruttura non presente in questo stack Expo+GitHub
-- Pages statico.
-- ============================================================

create table if not exists piani_annuali (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  season_id uuid references seasons on delete set null,
  titolo text not null default 'Piano annuale',
  contenuto text not null default '',
  generato_da_ai boolean not null default false,
  ultima_proposta_il timestamptz,
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);

alter table piani_annuali enable row level security;
drop policy if exists "piani_annuali_select_member" on piani_annuali;
create policy "piani_annuali_select_member" on piani_annuali for select using (is_team_member(team_id) or is_superuser());
drop policy if exists "piani_annuali_write_coach" on piani_annuali;
create policy "piani_annuali_write_coach" on piani_annuali for all using (is_team_coach(team_id)) with check (is_team_coach(team_id));

create table if not exists proposte_aggiornamento_piano (
  id uuid primary key default gen_random_uuid(),
  piano_id uuid not null references piani_annuali on delete cascade,
  contenuto_proposto text not null,
  motivo text not null default '',
  stato text not null default 'pendente' check (stato in ('pendente', 'accettata', 'rifiutata')),
  creato_il timestamptz not null default now(),
  decisa_il timestamptz
);

alter table proposte_aggiornamento_piano enable row level security;
drop policy if exists "proposte_piano_select_member" on proposte_aggiornamento_piano;
create policy "proposte_piano_select_member" on proposte_aggiornamento_piano for select using (
  is_team_member((select team_id from piani_annuali where id = piano_id)) or is_superuser()
);
drop policy if exists "proposte_piano_write_coach" on proposte_aggiornamento_piano;
create policy "proposte_piano_write_coach" on proposte_aggiornamento_piano for all using (
  is_team_coach((select team_id from piani_annuali where id = piano_id))
) with check (
  is_team_coach((select team_id from piani_annuali where id = piano_id))
);

-- Applica una proposta: sostituisce il contenuto del piano e marca la
-- proposta come accettata, in un'unica transazione.
create or replace function accetta_proposta_piano(p_proposta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_piano_id uuid;
  v_team_id uuid;
  v_contenuto text;
begin
  select pp.piano_id, pa.team_id, pp.contenuto_proposto into v_piano_id, v_team_id, v_contenuto
  from proposte_aggiornamento_piano pp join piani_annuali pa on pa.id = pp.piano_id
  where pp.id = p_proposta_id;

  if v_piano_id is null then raise exception 'Proposta non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update piani_annuali set contenuto = v_contenuto, aggiornato_il = now() where id = v_piano_id;
  update proposte_aggiornamento_piano set stato = 'accettata', decisa_il = now() where id = p_proposta_id;
end;
$$;

create or replace function rifiuta_proposta_piano(p_proposta_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
begin
  select pa.team_id into v_team_id from proposte_aggiornamento_piano pp join piani_annuali pa on pa.id = pp.piano_id where pp.id = p_proposta_id;
  if v_team_id is null then raise exception 'Proposta non trovata'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update proposte_aggiornamento_piano set stato = 'rifiutata', decisa_il = now() where id = p_proposta_id;
end;
$$;

revoke execute on function accetta_proposta_piano(uuid) from anon;
revoke execute on function rifiuta_proposta_piano(uuid) from anon;
grant execute on function accetta_proposta_piano(uuid) to authenticated;
grant execute on function rifiuta_proposta_piano(uuid) to authenticated;
