-- ============================================================
-- 0057 — mio_contesto_team() ed elenca_squadre_societa() aggiornate
-- per il modello stagione di società.
--
-- "stagione_aperta" resta il segnale che il client usa per instradare
-- alle schermate operative: è vero solo se ESISTE una stagione attiva
-- di società E questa specifica squadra è stata attivata per quella
-- stagione (team_stagioni_attivazioni). Aggiunto
-- "stagione_societa_esiste" per distinguere lato client "nessuna
-- stagione aperta per la società" da "la stagione c'è ma la tua
-- squadra non è ancora stata attivata".
-- ============================================================

drop function if exists mio_contesto_team();
drop function if exists elenca_squadre_societa(uuid);

create or replace function mio_contesto_team()
returns table(
  team_id uuid,
  team_nome text,
  team_creato_il timestamptz,
  team_societa_id uuid,
  ruolo text,
  atleta_id uuid,
  stagione_id uuid,
  stagione_nome text,
  stagione_stato text,
  stagione_societa_esiste boolean,
  stagione_aperta boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select tm.team_id, t.nome, t.creato_il, t.societa_id, tm.ruolo, tm.atleta_id,
      s.id, s.nome, s.stato,
      (s.id is not null),
      (s.stato = 'attiva' and tsa.id is not null)
    from team_members tm
    join teams t on t.id = tm.team_id
    left join seasons s on s.societa_id = t.societa_id and s.stato = 'attiva'
    left join team_stagioni_attivazioni tsa on tsa.team_id = tm.team_id and tsa.season_id = s.id
    where tm.user_id = auth.uid()
  union
  select t.id, t.nome, t.creato_il, t.societa_id, 'presidente', null::uuid,
    s.id, s.nome, s.stato,
    (s.id is not null),
    (s.stato = 'attiva' and tsa.id is not null)
  from teams t
  join societa_presidenti sp on sp.societa_id = t.societa_id and sp.fine_mandato is null
  left join seasons s on s.societa_id = t.societa_id and s.stato = 'attiva'
  left join team_stagioni_attivazioni tsa on tsa.team_id = t.id and tsa.season_id = s.id
  where sp.user_id = auth.uid()
    and t.id not in (select tm2.team_id from team_members tm2 where tm2.user_id = auth.uid())
  order by team_creato_il asc;
end;
$$;

create or replace function elenca_squadre_societa(p_societa_id uuid)
returns table(team_id uuid, nome text, numero_membri integer, allenatore_email text, stagione_attiva text, squadra_attivata boolean)
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
