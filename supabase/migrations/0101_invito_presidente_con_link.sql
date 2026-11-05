-- 0101 — Invito di un presidente di società con un link (per esempio su WhatsApp).
--
-- Come per allenatore e vice (0079): un presidente della società (o il superuser) genera un link personale,
-- monouso, valido 7 giorni. Chi lo apre accede con il suo account Google, qualunque sia la sua email, e
-- diventa presidente della società insieme a chi c'è già (nessuno perde il ruolo, come in invita_presidente_societa).

create table if not exists societa_presidenti_link (
  id uuid primary key default gen_random_uuid(),
  societa_id uuid not null references societa(id) on delete cascade,
  token text not null unique,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  scade_il timestamptz not null default now() + interval '7 days',
  usato_il timestamptz,
  usato_da uuid references auth.users(id) on delete set null
);
create index if not exists idx_societa_presidenti_link_societa on societa_presidenti_link(societa_id);
alter table societa_presidenti_link enable row level security;
-- Nessuna policy: il client non legge né scrive la tabella; passa solo dalle funzioni qui sotto.
revoke all on table societa_presidenti_link from public, anon, authenticated;

create or replace function crea_invito_presidente_link(p_societa_id uuid)
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
  if not (is_societa_presidente(p_societa_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  insert into societa_presidenti_link (societa_id, token, creato_da) values (p_societa_id, v_token, auth.uid());
  return v_token;
end;
$$;

-- Anteprima per chi apre il link prima di accedere: solo il nome della società, e solo se il link è valido.
create or replace function anteprima_invito_presidente_link(p_token text)
returns table (societa_nome text)
language sql
stable
security definer
set search_path = public
as $$
  select s.nome
  from societa_presidenti_link l join societa s on s.id = l.societa_id
  where l.token = p_token and l.usato_il is null and l.scade_il > now();
$$;

create or replace function accetta_invito_presidente_link(p_token text)
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

  select * into v_link from societa_presidenti_link where token = p_token for update;
  if v_link is null then raise exception 'Invito non valido'; end if;
  if v_link.usato_il is not null then raise exception 'Questo invito è già stato usato'; end if;
  if v_link.scade_il <= now() then raise exception 'Questo invito è scaduto: chiedine uno nuovo'; end if;
  if exists (select 1 from societa_presidenti where societa_id = v_link.societa_id and user_id = auth.uid() and fine_mandato is null) then
    raise exception 'Sei già presidente di questa società';
  end if;

  insert into societa_presidenti (societa_id, user_id, nominato_da) values (v_link.societa_id, auth.uid(), v_link.creato_da);
  update societa_presidenti_link set usato_il = now(), usato_da = auth.uid() where id = v_link.id;
  return v_link.societa_id;
end;
$$;

revoke execute on function crea_invito_presidente_link(uuid) from public, anon;
revoke execute on function accetta_invito_presidente_link(text) from public, anon;
grant execute on function crea_invito_presidente_link(uuid) to authenticated;
grant execute on function accetta_invito_presidente_link(text) to authenticated;
grant execute on function anteprima_invito_presidente_link(text) to anon, authenticated;

-- ── Rollback ──
-- drop function if exists accetta_invito_presidente_link(text);
-- drop function if exists anteprima_invito_presidente_link(text);
-- drop function if exists crea_invito_presidente_link(uuid);
-- drop table if exists societa_presidenti_link;
