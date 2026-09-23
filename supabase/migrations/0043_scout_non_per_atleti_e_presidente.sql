-- 0043 — Il permesso scout non si assegna ad atleti né al presidente

create or replace function imposta_permesso_scout(p_team_id uuid, p_user_id uuid, p_abilitato boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_ruolo text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  select ruolo into v_ruolo from team_members where team_id = p_team_id and user_id = p_user_id;
  if v_ruolo is null then raise exception 'Questa persona non fa parte della squadra'; end if;

  if p_abilitato and v_ruolo in ('atleta', 'presidente') then
    raise exception 'Il permesso scout si assegna solo allo staff tecnico: chi registra le azioni sta in panchina';
  end if;

  update team_members set puo_scoutare = p_abilitato where team_id = p_team_id and user_id = p_user_id;
end;
$$;

update team_members set puo_scoutare = false
where puo_scoutare = true and ruolo in ('atleta', 'presidente');

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
  if p_nuovo_ruolo not in ('allenatore','vice_allenatore','presidente','atleta') then
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
      raise exception 'Scheda non trovata in questa squadra';
    end if;
    if exists (select 1 from team_members where atleta_id = p_atleta_id and user_id <> p_user_id) then
      raise exception 'Questa scheda è già collegata a un altro account';
    end if;
  end if;

  update team_members
  set ruolo = p_nuovo_ruolo,
      atleta_id = case when p_nuovo_ruolo = 'atleta' then p_atleta_id else null end,
      puo_scoutare = case when p_nuovo_ruolo in ('atleta','presidente') then false else puo_scoutare end
  where team_id = p_team_id and user_id = p_user_id;
end;
$$;
