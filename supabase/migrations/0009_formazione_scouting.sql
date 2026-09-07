-- ============================================================
-- 0009 — Formazione in campo (scouting avanzato, prima parte)
--
-- Risponde a: "lo scouting mi dà tutti i giocatori e non solo quelli
-- che possono eseguire l'azione". Implementata la parte "chi è
-- davvero in campo ora" (formazione/sostituzioni), filtrando la
-- striscia atlete dello scouting live a queste sole 6.
--
-- NON implementata in questa passata la rotazione automatica per
-- ruolo di servizio (chi sta servendo/ricevendo secondo le regole
-- ufficiali di rotazione) — è un ulteriore livello di complessità
-- (macchina a stati sul turno di servizio, cambio a ogni side-out)
-- rimandato di proposito: la formazione già riduce drasticamente la
-- lista a un tap, la rotazione automatica è un affinamento successivo.
-- ============================================================

create table if not exists match_set_lineups (
  id uuid primary key default gen_random_uuid(),
  set_id uuid not null references match_sets on delete cascade,
  athlete_id uuid not null references athletes on delete cascade,
  in_campo boolean not null default true,
  aggiornato_il timestamptz not null default now(),
  unique (set_id, athlete_id)
);

create index if not exists idx_match_set_lineups_set on match_set_lineups (set_id) where in_campo = true;

alter table match_set_lineups enable row level security;

drop policy if exists "match_set_lineups_select_ristretta" on match_set_lineups;
create policy "match_set_lineups_select_ristretta" on match_set_lineups for select using (
  is_team_staff_visione_piena((select team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = set_id))
  or athlete_id = mio_atleta_id((select team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = set_id))
  or is_superuser()
);

-- Nessuna policy insert/update/delete diretta per il client: si passa
-- sempre dalla RPC qui sotto (stesso pattern di registra_evento), che
-- verifica coach + coerenza di team tra set/atleta.
create or replace function imposta_formazione_set(p_set_id uuid, p_athlete_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_athlete_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select m.team_id into v_team_id from match_sets ms join matches m on m.id = ms.match_id where ms.id = p_set_id;
  if v_team_id is null then raise exception 'Set non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  foreach v_athlete_id in array p_athlete_ids
  loop
    if not exists (select 1 from athletes where id = v_athlete_id and team_id = v_team_id) then
      raise exception 'Una delle atlete indicate non appartiene a questa squadra';
    end if;
  end loop;

  delete from match_set_lineups where set_id = p_set_id;

  foreach v_athlete_id in array p_athlete_ids
  loop
    insert into match_set_lineups (set_id, athlete_id, in_campo) values (p_set_id, v_athlete_id, true);
  end loop;
end;
$$;

revoke execute on function imposta_formazione_set(uuid, uuid[]) from anon;
grant execute on function imposta_formazione_set(uuid, uuid[]) to authenticated;
