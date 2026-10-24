-- Schemi di gioco STANDARD: valgono per tutte le squadre (e quindi per tutte
-- le stagioni, perche' gli schemi stanno sulla squadra e non sulla stagione).
-- Ogni allenatore puo' personalizzarli: lo schema salvato dalla squadra
-- prevale sullo standard solo per quella fase/variante/rotazione. "Ripristina"
-- cancella lo schema della squadra e si torna allo standard.
-- Lo standard iniziale e' copiato dagli schemi della squadra PEACH.

create table if not exists schemi_gioco_standard (
  fase text not null check (fase in ('ricezione', 'difesa', 'copertura')),
  variante smallint not null check (variante between 1 and 2),
  rotazione smallint not null check (rotazione between 1 and 6),
  assegnazioni jsonb not null,
  aggiornato_il timestamptz not null default now(),
  aggiornato_da uuid default auth.uid(),
  primary key (fase, variante, rotazione)
);

-- Nessuna lettura/scrittura diretta: si passa solo dalle funzioni qui sotto.
alter table schemi_gioco_standard enable row level security;

insert into schemi_gioco_standard (fase, variante, rotazione, assegnazioni)
select fase, variante, rotazione, assegnazioni
from schemi_gioco
where team_id = '6620b1ad-ffe1-42c9-8ee0-753e841c6f1b'
on conflict (fase, variante, rotazione) do nothing;

-- Schemi in vigore per una squadra: i suoi, piu' lo standard dove la squadra non ha il proprio.
create or replace function schemi_gioco_efficaci(p_team_id uuid)
returns table (fase text, variante smallint, rotazione smallint, assegnazioni jsonb, standard boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_team_member(p_team_id) or is_team_presidente(p_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  return query
    select s.fase, s.variante, s.rotazione, s.assegnazioni, false
    from schemi_gioco s where s.team_id = p_team_id
    union all
    select d.fase, d.variante, d.rotazione, d.assegnazioni, true
    from schemi_gioco_standard d
    where not exists (
      select 1 from schemi_gioco s
      where s.team_id = p_team_id and s.fase = d.fase and s.variante = d.variante and s.rotazione = d.rotazione
    );
end;
$$;

revoke execute on function schemi_gioco_efficaci(uuid) from public, anon;
grant execute on function schemi_gioco_efficaci(uuid) to authenticated;

-- Solo il superuser: sostituisce lo standard con gli schemi di una squadra.
create or replace function imposta_schemi_standard_da_squadra(p_team_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_superuser() then raise exception 'Permesso negato'; end if;
  if not exists (select 1 from schemi_gioco where team_id = p_team_id) then
    raise exception 'La squadra non ha schemi salvati';
  end if;
  delete from schemi_gioco_standard where true;
  insert into schemi_gioco_standard (fase, variante, rotazione, assegnazioni, aggiornato_il, aggiornato_da)
  select fase, variante, rotazione, assegnazioni, now(), auth.uid() from schemi_gioco where team_id = p_team_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function imposta_schemi_standard_da_squadra(uuid) from public, anon;
grant execute on function imposta_schemi_standard_da_squadra(uuid) to authenticated;
