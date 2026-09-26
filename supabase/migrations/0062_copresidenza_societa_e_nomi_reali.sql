-- ============================================================
-- 0062 — Co-presidenza di società: più persone possono essere
-- presidente della stessa società insieme. Si aggiungono e si
-- rimuovono esplicitamente (mai per sostituzione automatica: il
-- presidente uscente non perde mai il ruolo da solo). Aggiunge anche
-- il nome reale (recuperato da Google al login) al posto della sola
-- email ovunque si mostrino allenatore, vice e presidenti.
-- ============================================================

/** Nome per l'interfaccia: quello reale da Google se c'è, altrimenti l'email. */
create or replace function nome_utente(p_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(u.raw_user_meta_data->>'full_name', u.raw_user_meta_data->>'name', u.email)
  from auth.users u where u.id = p_user_id;
$$;

create or replace function elenca_presidenti_societa(p_societa_id uuid)
returns table(user_id uuid, email text, nome text, inizio_mandato timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_societa_presidente(p_societa_id) or is_superuser()) then
    raise exception 'Permesso negato';
  end if;

  return query
  select sp.user_id, u.email::text, nome_utente(sp.user_id), sp.inizio_mandato
  from societa_presidenti sp
  join auth.users u on u.id = sp.user_id
  where sp.societa_id = p_societa_id and sp.fine_mandato is null
  order by sp.inizio_mandato asc;
end;
$$;

/** Aggiunge un presidente in più: non tocca chi c'è già. Stesso meccanismo a invito silenzioso degli altri ruoli. */
create or replace function invita_presidente_societa(p_societa_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_societa_presidente(p_societa_id) or is_superuser()) then
    raise exception 'Permesso negato';
  end if;

  v_email := lower(trim(p_email));
  if v_email = '' or v_email is null then raise exception 'Email non valida'; end if;

  select id into v_user_id from auth.users where lower(email) = v_email limit 1;

  if v_user_id is not null then
    if exists (select 1 from societa_presidenti where societa_id = p_societa_id and user_id = v_user_id and fine_mandato is null) then
      raise exception 'Questa persona è già presidente di questa società';
    end if;
    insert into societa_presidenti (societa_id, user_id, nominato_da) values (p_societa_id, v_user_id, auth.uid());
  else
    delete from societa_presidenti_inviti where societa_id = p_societa_id and lower(email) = v_email and usato_il is null;
    insert into societa_presidenti_inviti (societa_id, email, creato_da) values (p_societa_id, v_email, auth.uid());
  end if;
end;
$$;

/** Rimuove esplicitamente un presidente. Impedisce a un presidente di lasciare la società senza nessuno al comando: solo l'amministratore della piattaforma può farlo se resta l'ultimo. */
create or replace function rimuovi_presidente_societa(p_societa_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quanti integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_societa_presidente(p_societa_id) or is_superuser()) then
    raise exception 'Permesso negato';
  end if;

  select count(*) into v_quanti from societa_presidenti where societa_id = p_societa_id and fine_mandato is null;
  if v_quanti <= 1 and not is_superuser() then
    raise exception 'È l''unico presidente rimasto: assegna prima un altro presidente prima di rimuoverlo';
  end if;

  update societa_presidenti set fine_mandato = now()
  where societa_id = p_societa_id and user_id = p_user_id and fine_mandato is null;
end;
$$;

-- elenca_squadre_societa: aggiunge il nome reale di allenatore e vice
-- accanto all'email (che resta, serve come identificatore per invitare
-- e riassegnare).
drop function if exists elenca_squadre_societa(uuid);

create or replace function elenca_squadre_societa(p_societa_id uuid)
returns table(
  team_id uuid,
  nome text,
  numero_membri integer,
  allenatore_email text,
  allenatore_nome text,
  vice_allenatore_email text,
  vice_allenatore_nome text,
  stagione_attiva text,
  squadra_attivata boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_societa_presidente(p_societa_id) then raise exception 'Permesso negato'; end if;

  return query
  select t.id, t.nome,
    (select count(*)::integer from team_members tm where tm.team_id = t.id),
    (select u.email::text from team_members tm join auth.users u on u.id = tm.user_id where tm.team_id = t.id and tm.ruolo = 'allenatore' limit 1),
    (select nome_utente(tm.user_id) from team_members tm where tm.team_id = t.id and tm.ruolo = 'allenatore' limit 1),
    (select u.email::text from team_members tm join auth.users u on u.id = tm.user_id where tm.team_id = t.id and tm.ruolo = 'vice_allenatore' limit 1),
    (select nome_utente(tm.user_id) from team_members tm where tm.team_id = t.id and tm.ruolo = 'vice_allenatore' limit 1),
    (select s.nome from seasons s where s.societa_id = p_societa_id and s.stato = 'attiva' limit 1),
    (exists (
      select 1 from team_stagioni_attivazioni tsa
      join seasons s on s.id = tsa.season_id
      where tsa.team_id = t.id and s.societa_id = p_societa_id and s.stato = 'attiva'
    ))
  from teams t
  where t.societa_id = p_societa_id
  order by t.creato_il;
end;
$$;
