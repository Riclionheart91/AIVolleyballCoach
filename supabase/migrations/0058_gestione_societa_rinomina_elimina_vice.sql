-- ============================================================
-- 0058 — Task #8: espande la Gestione società con rinomina squadra,
-- eliminazione squadra e visibilità del vice-allenatore oltre
-- all'allenatore.
-- ============================================================

drop function if exists elenca_squadre_societa(uuid);

create or replace function elenca_squadre_societa(p_societa_id uuid)
returns table(
  team_id uuid,
  nome text,
  numero_membri integer,
  allenatore_email text,
  vice_allenatore_email text,
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
    (select u.email::text from team_members tm join auth.users u on u.id = tm.user_id where tm.team_id = t.id and tm.ruolo = 'vice_allenatore' limit 1),
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

create or replace function assegna_collaboratore_squadra(p_team_id uuid, p_email text, p_ruolo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_societa_id uuid;
  v_email_normalizzata text;
  v_invito_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if p_ruolo not in ('allenatore', 'vice_allenatore') then raise exception 'Profilo non valido'; end if;
  select societa_id into v_societa_id from teams where id = p_team_id;
  if v_societa_id is null or not is_societa_presidente(v_societa_id) then
    raise exception 'Solo il presidente della società può assegnare allenatore e vice';
  end if;

  v_email_normalizzata := lower(trim(p_email));
  if v_email_normalizzata = '' or v_email_normalizzata is null then raise exception 'Email non valida'; end if;

  delete from team_invites where team_id = p_team_id and lower(email) = v_email_normalizzata and usato_il is null;
  insert into team_invites (team_id, email, ruolo, creato_da)
  values (p_team_id, v_email_normalizzata, p_ruolo, auth.uid())
  returning id into v_invito_id;

  return v_invito_id;
end;
$$;

create or replace function rinomina_squadra(p_team_id uuid, p_nome_nuovo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome_pulito text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_presidente(p_team_id) then raise exception 'Permesso negato: solo il presidente della società'; end if;

  v_nome_pulito := trim(p_nome_nuovo);
  if v_nome_pulito = '' or v_nome_pulito is null then raise exception 'Il nome della squadra non può essere vuoto'; end if;

  update teams set nome = v_nome_pulito where id = p_team_id;
end;
$$;

create or replace function elimina_squadra(p_team_id uuid, p_nome_conferma text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome_reale text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_presidente(p_team_id) then raise exception 'Permesso negato: solo il presidente della società'; end if;

  select nome into v_nome_reale from teams where id = p_team_id;
  if v_nome_reale is null then raise exception 'Squadra non trovata'; end if;
  if trim(p_nome_conferma) <> v_nome_reale then
    raise exception 'Il nome digitato non corrisponde: eliminazione annullata per sicurezza';
  end if;

  delete from teams where id = p_team_id;
end;
$$;
