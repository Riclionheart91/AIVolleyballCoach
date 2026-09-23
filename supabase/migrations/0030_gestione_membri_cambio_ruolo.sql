-- 0030 — Gestione membri: elenco unificato e cambio profilo

create or replace function elenca_membri_team(p_team_id uuid)
returns table(user_id uuid, email text, ruolo text, atleta_id uuid, atleta_nome text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  return query
    select tm.user_id, u.email::text, tm.ruolo, tm.atleta_id,
           case when a.id is not null then a.nome || ' ' || a.cognome else null end
    from team_members tm
    join auth.users u on u.id = tm.user_id
    left join athletes a on a.id = tm.atleta_id
    where tm.team_id = p_team_id
    order by tm.ruolo, u.email;
end;
$$;

create or replace function cambia_ruolo_membro(p_team_id uuid, p_user_id uuid, p_nuovo_ruolo text, p_atleta_id uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ruolo_attuale text;
  v_altri_allenatori integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;
  if p_nuovo_ruolo not in ('allenatore','vice_allenatore','presidente','atleta','scout') then
    raise exception 'Profilo non valido';
  end if;

  select ruolo into v_ruolo_attuale from team_members where team_id = p_team_id and user_id = p_user_id;
  if v_ruolo_attuale is null then raise exception 'Questa persona non fa parte della squadra'; end if;

  if v_ruolo_attuale = 'allenatore' and p_nuovo_ruolo <> 'allenatore' then
    select count(*) into v_altri_allenatori from team_members
    where team_id = p_team_id and ruolo = 'allenatore' and user_id <> p_user_id;
    if v_altri_allenatori = 0 then
      raise exception 'Non puoi togliere l''ultimo allenatore della squadra: nominane prima un altro';
    end if;
  end if;

  if p_nuovo_ruolo = 'atleta' then
    if p_atleta_id is null then raise exception 'Per il profilo atleta indica a quale scheda collegarlo'; end if;
    if not exists (select 1 from athletes where id = p_atleta_id and team_id = p_team_id) then
      raise exception 'Scheda atleta non trovata in questa squadra';
    end if;
    if exists (select 1 from team_members where atleta_id = p_atleta_id and user_id <> p_user_id) then
      raise exception 'Questa scheda atleta è già collegata a un altro account';
    end if;
  end if;

  update team_members
  set ruolo = p_nuovo_ruolo,
      atleta_id = case when p_nuovo_ruolo = 'atleta' then p_atleta_id else null end
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;

create or replace function rimuovi_membro(p_team_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_altri_allenatori integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  select count(*) into v_altri_allenatori from team_members
  where team_id = p_team_id and ruolo = 'allenatore' and user_id <> p_user_id;
  if v_altri_allenatori = 0 and exists (
    select 1 from team_members where team_id = p_team_id and user_id = p_user_id and ruolo = 'allenatore'
  ) then
    raise exception 'Non puoi rimuovere l''ultimo allenatore della squadra';
  end if;

  delete from team_members where team_id = p_team_id and user_id = p_user_id;
end;
$$;

revoke all on function elenca_membri_team(uuid) from public, anon;
revoke all on function cambia_ruolo_membro(uuid, uuid, text, uuid) from public, anon;
revoke all on function rimuovi_membro(uuid, uuid) from public, anon;
grant execute on function elenca_membri_team(uuid) to authenticated, service_role;
grant execute on function cambia_ruolo_membro(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function rimuovi_membro(uuid, uuid) to authenticated, service_role;
