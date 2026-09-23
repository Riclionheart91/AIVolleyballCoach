-- 0035 — Rimpiazzi del Libero (versione iniziale, corretta poi da 0050/0051)

create table if not exists rimpiazzi_libero (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references match_sets on delete cascade,
  libero_id uuid not null references athletes on delete cascade,
  titolare_id uuid not null references athletes on delete cascade,
  posizione integer not null check (posizione between 1 and 6),
  entrato_il timestamptz not null default now(),
  uscito_il timestamptz
);

create index if not exists idx_rimpiazzi_libero_set on rimpiazzi_libero (set_id) where uscito_il is null;

alter table rimpiazzi_libero enable row level security;
drop policy if exists "rimpiazzi_libero_select" on rimpiazzi_libero;
create policy "rimpiazzi_libero_select" on rimpiazzi_libero for select using (
  is_team_scout((select m.team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = set_id))
  or is_superuser()
);

create or replace function rimpiazza_con_libero(p_set_id uuid, p_libero_id uuid, p_titolare_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_match_id uuid;
  v_posizione integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select m.id, m.team_id into v_match_id, v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  if not exists (select 1 from match_convocati where match_id = v_match_id and athlete_id = p_libero_id and is_libero = true) then
    raise exception 'Questa giocatrice non è indicata come Libero nella distinta';
  end if;

  select posizione into v_posizione from match_set_lineups
  where set_id = p_set_id and athlete_id = p_titolare_id and in_campo = true;
  if v_posizione is null then raise exception 'La giocatrice da rimpiazzare non è in campo'; end if;

  if v_posizione not in (1, 5, 6) then
    raise exception 'Il Libero può entrare solo in seconda linea (posizioni 5, 6, 1): la giocatrice è in posizione %', v_posizione;
  end if;
  if v_posizione = 1 then
    raise exception 'Il Libero non può servire: non può entrare in posizione 1';
  end if;

  if exists (select 1 from rimpiazzi_libero where set_id = p_set_id and uscito_il is null) then
    raise exception 'C''è già un Libero in campo: fallo uscire prima';
  end if;

  update match_set_lineups set in_campo = false, posizione = null
  where set_id = p_set_id and athlete_id = p_titolare_id;

  insert into match_set_lineups (set_id, athlete_id, in_campo, posizione)
  values (p_set_id, p_libero_id, true, v_posizione)
  on conflict (set_id, athlete_id) do update set in_campo = true, posizione = v_posizione;

  insert into rimpiazzi_libero (set_id, libero_id, titolare_id, posizione)
  values (p_set_id, p_libero_id, p_titolare_id, v_posizione);
end;
$$;

create or replace function fai_uscire_libero(p_set_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_rimpiazzo record;
  v_posizione_attuale integer;
begin
  select m.team_id into v_team_id
  from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_scout(v_team_id) then raise exception 'Permesso negato'; end if;

  select * into v_rimpiazzo from rimpiazzi_libero
  where set_id = p_set_id and uscito_il is null
  order by entrato_il desc limit 1;
  if v_rimpiazzo is null then return; end if;

  select posizione into v_posizione_attuale from match_set_lineups
  where set_id = p_set_id and athlete_id = v_rimpiazzo.libero_id and in_campo = true;

  update match_set_lineups set in_campo = false, posizione = null
  where set_id = p_set_id and athlete_id = v_rimpiazzo.libero_id;

  update match_set_lineups set in_campo = true, posizione = v_posizione_attuale
  where set_id = p_set_id and athlete_id = v_rimpiazzo.titolare_id;

  update rimpiazzi_libero set uscito_il = now() where id = v_rimpiazzo.id;
end;
$$;

create or replace function gestisci_libero_dopo_rotazione(p_set_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_posizione integer;
begin
  select l.posizione into v_posizione
  from rimpiazzi_libero r
  join match_set_lineups l on l.set_id = r.set_id and l.athlete_id = r.libero_id and l.in_campo = true
  where r.set_id = p_set_id and r.uscito_il is null
  limit 1;

  if v_posizione is not null and v_posizione in (2, 3, 4) then
    perform fai_uscire_libero(p_set_id);
  end if;
end;
$$;

create or replace function applica_rotazione_dopo_evento()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare v_punto_avversario boolean;
begin
  v_punto_avversario := (NEW.skill in ('Punto_avversario','Fallo_rotazione') or NEW.esito = 'errore');

  if NEW.rotazione_applicata then
    perform ruota_formazione(NEW.set_id);
    perform gestisci_libero_dopo_rotazione(NEW.set_id);
    update match_sets
      set squadra_al_servizio = 'noi', turno_servizio_corrente = turno_servizio_corrente + 1
      where id = NEW.set_id;
  elsif v_punto_avversario and NEW.servizio_precedente is distinct from 'avversario' then
    update match_sets
      set squadra_al_servizio = 'avversario', turno_servizio_corrente = turno_servizio_corrente + 1
      where id = NEW.set_id;
  end if;

  return NEW;
end;
$$;

create or replace function libero_in_campo(p_set_id uuid)
returns table(libero_id uuid, titolare_id uuid, posizione integer)
language sql stable security definer set search_path = public
as $$
  select r.libero_id, r.titolare_id, l.posizione
  from rimpiazzi_libero r
  left join match_set_lineups l on l.set_id = r.set_id and l.athlete_id = r.libero_id and l.in_campo = true
  where r.set_id = p_set_id and r.uscito_il is null
    and is_team_scout((select m.team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id))
  limit 1;
$$;

revoke all on function rimpiazza_con_libero(uuid, uuid, uuid) from public, anon;
revoke all on function fai_uscire_libero(uuid) from public, anon;
revoke all on function gestisci_libero_dopo_rotazione(uuid) from public, anon;
revoke all on function libero_in_campo(uuid) from public, anon;
grant execute on function rimpiazza_con_libero(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function fai_uscire_libero(uuid) to authenticated, service_role;
grant execute on function gestisci_libero_dopo_rotazione(uuid) to authenticated, service_role;
grant execute on function libero_in_campo(uuid) to authenticated, service_role;
