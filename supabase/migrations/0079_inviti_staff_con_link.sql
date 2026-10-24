-- Inviti dello staff (allenatore, vice) con un link personale invece dell'email.
-- Chi ha il permesso sceglie squadra e ruolo e genera un link monouso, valido 7 giorni, da mandare
-- (per esempio su WhatsApp). Chi lo apre accede con il suo account Google, qualunque sia la sua email,
-- ed entra nella squadra con quel ruolo: il link si chiude e non vale piu'.

create table if not exists team_invite_links (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references teams(id) on delete cascade,
  ruolo text not null check (ruolo in ('allenatore', 'vice_allenatore')),
  token text not null unique,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  scade_il timestamptz not null default now() + interval '7 days',
  usato_il timestamptz,
  usato_da uuid references auth.users(id) on delete set null
);
create index if not exists idx_team_invite_links_team on team_invite_links(team_id);
alter table team_invite_links enable row level security;

-- Chi puo' gestire i link di una squadra: staff tecnico, presidente della societa' o superuser.
create or replace function puo_gestire_inviti_staff(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select is_team_coach(p_team_id)
      or is_superuser()
      or exists (select 1 from teams t where t.id = p_team_id and t.societa_id is not null and is_societa_presidente(t.societa_id));
$$;

drop policy if exists team_invite_links_lettura on team_invite_links;
create policy team_invite_links_lettura on team_invite_links for select to authenticated
  using (puo_gestire_inviti_staff(team_id));

create or replace function crea_invito_link(p_team_id uuid, p_ruolo text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception 'Permesso negato'; end if;
  if not puo_gestire_inviti_staff(p_team_id) then raise exception 'Permesso negato'; end if;
  if p_ruolo not in ('allenatore', 'vice_allenatore') then raise exception 'Ruolo non valido'; end if;
  insert into team_invite_links (team_id, ruolo, token, creato_da) values (p_team_id, p_ruolo, v_token, auth.uid());
  return v_token;
end;
$$;

-- Anteprima per chi apre il link prima di accedere: solo nome squadra e ruolo, e solo se il link e' valido.
create or replace function anteprima_invito_link(p_token text)
returns table (team_nome text, ruolo text)
language sql
stable
security definer
set search_path = public
as $$
  select t.nome, l.ruolo
  from team_invite_links l join teams t on t.id = l.team_id
  where l.token = p_token and l.usato_il is null and l.scade_il > now();
$$;

create or replace function accetta_invito_link(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link record;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Per usare l''invito accedi con un account Google';
  end if;

  select * into v_link from team_invite_links where token = p_token for update;
  if v_link is null then raise exception 'Invito non valido'; end if;
  if v_link.usato_il is not null then raise exception 'Questo invito e'' gia'' stato usato'; end if;
  if v_link.scade_il <= now() then raise exception 'Questo invito e'' scaduto: chiedine uno nuovo'; end if;
  if exists (select 1 from team_members where team_id = v_link.team_id and user_id = auth.uid()) then
    raise exception 'Fai gia'' parte di questa squadra';
  end if;

  insert into team_members (team_id, user_id, ruolo) values (v_link.team_id, auth.uid(), v_link.ruolo);
  update team_invite_links set usato_il = now(), usato_da = auth.uid() where id = v_link.id;
  return v_link.team_id;
end;
$$;

create or replace function annulla_invito_link(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team uuid;
begin
  select team_id into v_team from team_invite_links where id = p_id and usato_il is null;
  if v_team is null then return; end if;
  if not puo_gestire_inviti_staff(v_team) then raise exception 'Permesso negato'; end if;
  delete from team_invite_links where id = p_id;
end;
$$;

revoke execute on function puo_gestire_inviti_staff(uuid) from public, anon;
revoke execute on function crea_invito_link(uuid, text) from public, anon;
revoke execute on function accetta_invito_link(text) from public, anon;
revoke execute on function annulla_invito_link(uuid) from public, anon;
grant execute on function puo_gestire_inviti_staff(uuid) to authenticated;
grant execute on function crea_invito_link(uuid, text) to authenticated;
grant execute on function accetta_invito_link(text) to authenticated;
grant execute on function annulla_invito_link(uuid) to authenticated;
grant execute on function anteprima_invito_link(text) to anon, authenticated;
