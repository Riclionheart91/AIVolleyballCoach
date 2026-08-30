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

drop policy if exists "season_baselines_select_member" on season_baselines;
drop policy if exists "season_baselines_select_ristretta" on season_baselines;
create policy "season_baselines_select_ristretta" on season_baselines for select using (
  is_team_staff_visione_piena((select team_id from seasons where id = season_id))
  or athlete_id = mio_atleta_id((select team_id from seasons where id = season_id))
);

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
