-- ============================================================
-- 0054 — schermata "crea società" per l'amministratore
--
-- L'amministratore indica nome società + email del futuro presidente.
-- Se quella persona ha già un account, diventa presidente subito. Se
-- non ce l'ha ancora, l'invito resta in sospeso e viene applicato
-- automaticamente al suo primo login — stesso meccanismo già in uso per
-- gli inviti squadra (team_invites + accetta_inviti_pendenti()).
-- ============================================================

create table if not exists societa_presidenti_inviti (
  id uuid primary key default gen_random_uuid(),
  societa_id uuid not null references societa(id) on delete cascade,
  email text not null,
  creato_da uuid references auth.users(id) on delete set null,
  creato_il timestamptz not null default now(),
  usato_il timestamptz
);

alter table societa_presidenti_inviti enable row level security;

create policy societa_presidenti_inviti_superuser on societa_presidenti_inviti
  for all using (is_superuser()) with check (is_superuser());

create or replace function crea_societa_con_presidente(p_nome text, p_email_presidente text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_societa_id uuid;
  v_nome_pulito text;
  v_email text;
  v_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_superuser() then raise exception 'Solo l''amministratore della piattaforma può fondare una nuova società'; end if;

  v_nome_pulito := trim(p_nome);
  if v_nome_pulito = '' or v_nome_pulito is null then raise exception 'Il nome della società non può essere vuoto'; end if;

  v_email := lower(trim(p_email_presidente));
  if v_email = '' or v_email is null then raise exception 'Email del presidente non valida'; end if;

  insert into societa (nome, creato_da) values (v_nome_pulito, auth.uid()) returning id into v_societa_id;

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;

  if v_user_id is not null then
    insert into societa_presidenti (societa_id, user_id, nominato_da) values (v_societa_id, v_user_id, auth.uid());
  else
    insert into societa_presidenti_inviti (societa_id, email, creato_da) values (v_societa_id, v_email, auth.uid());
  end if;

  return v_societa_id;
end;
$$;

-- accetta_inviti_pendenti() estesa: al login, applica anche un eventuale
-- invito di presidenza società in sospeso per quell'email, oltre
-- all'invito squadra già gestito.
create or replace function accetta_inviti_pendenti()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_invito record;
  v_invito_societa record;
begin
  if auth.uid() is null then
    return null;
  end if;

  select email into v_email from auth.users where id = auth.uid();
  if v_email is null then
    return null;
  end if;

  for v_invito_societa in
    select * from societa_presidenti_inviti
    where lower(email) = lower(v_email) and usato_il is null
    for update skip locked
  loop
    if not exists (
      select 1 from societa_presidenti
      where societa_id = v_invito_societa.societa_id and user_id = auth.uid() and fine_mandato is null
    ) then
      insert into societa_presidenti (societa_id, user_id, nominato_da)
      values (v_invito_societa.societa_id, auth.uid(), v_invito_societa.creato_da);
    end if;
    update societa_presidenti_inviti set usato_il = now() where id = v_invito_societa.id;
  end loop;

  select * into v_invito from team_invites
    where lower(email) = lower(v_email) and usato_il is null
    order by creato_il asc
    limit 1
    for update skip locked;

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
