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
