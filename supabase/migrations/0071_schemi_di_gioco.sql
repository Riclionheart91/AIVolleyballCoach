-- Schemi di gioco: dove stanno davvero le giocatrici nelle diverse fasi.
-- In ricezione, in difesa e in copertura d'attacco le giocatrici non stanno
-- nelle posizioni di rotazione (1-6): si dispongono secondo uno schema.
-- Per ogni squadra, fase e rotazione (identificata da dove si trova la
-- palleggiatrice, 1-6) si memorizza in quale zona del campo va ciascuna
-- posizione di rotazione. Le assegnazioni sono un oggetto {"1":4,"2":3,...}:
-- posizione di rotazione -> zona del campo; deve essere una permutazione di 1-6.

create table if not exists schemi_gioco (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams on delete cascade,
  fase text not null check (fase in ('ricezione', 'difesa', 'copertura')),
  rotazione smallint not null check (rotazione between 1 and 6),
  assegnazioni jsonb not null,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid default auth.uid(),
  unique (team_id, fase, rotazione)
);

alter table schemi_gioco enable row level security;
drop policy if exists "schemi_gioco_select" on schemi_gioco;
create policy "schemi_gioco_select" on schemi_gioco for select using (is_team_member(team_id) or is_superuser());

-- Salva (o sostituisce) lo schema di una fase e rotazione. Solo allenatori.
create or replace function salva_schema_gioco(p_team_id uuid, p_fase text, p_rotazione integer, p_assegnazioni jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chiave integer;
  v_zona integer;
  v_zone integer[] := '{}';
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_team_coach(p_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if p_fase not in ('ricezione', 'difesa', 'copertura') then raise exception 'Fase non valida'; end if;
  if p_rotazione < 1 or p_rotazione > 6 then raise exception 'Rotazione non valida'; end if;
  if p_assegnazioni is null or jsonb_typeof(p_assegnazioni) <> 'object' then raise exception 'Schema non valido'; end if;

  for v_chiave in 1..6 loop
    if (p_assegnazioni ->> v_chiave::text) is null then raise exception 'Schema incompleto: manca la posizione %', v_chiave; end if;
    v_zona := (p_assegnazioni ->> v_chiave::text)::integer;
    if v_zona < 1 or v_zona > 6 then raise exception 'Zona non valida: %', v_zona; end if;
    if v_zona = any (v_zone) then raise exception 'Due posizioni nella stessa zona (%)', v_zona; end if;
    v_zone := v_zone || v_zona;
  end loop;

  insert into schemi_gioco (team_id, fase, rotazione, assegnazioni, aggiornato_il, aggiornato_da)
  values (p_team_id, p_fase, p_rotazione, p_assegnazioni, now(), auth.uid())
  on conflict (team_id, fase, rotazione)
  do update set assegnazioni = excluded.assegnazioni, aggiornato_il = now(), aggiornato_da = auth.uid();
end;
$$;

revoke execute on function salva_schema_gioco(uuid, text, integer, jsonb) from public, anon;
grant execute on function salva_schema_gioco(uuid, text, integer, jsonb) to authenticated;

-- Torna allo schema di base (nessuno scostamento dalle posizioni di rotazione).
create or replace function ripristina_schema_gioco(p_team_id uuid, p_fase text, p_rotazione integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_team_coach(p_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  delete from schemi_gioco where team_id = p_team_id and fase = p_fase and rotazione = p_rotazione;
end;
$$;

revoke execute on function ripristina_schema_gioco(uuid, text, integer) from public, anon;
grant execute on function ripristina_schema_gioco(uuid, text, integer) to authenticated;
