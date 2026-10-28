-- 0088 — Il superuser (amministratore di sistema) vede nell'app tutte le squadre, in consultazione.
-- Per le squadre in cui non e' membro ne' presidente compare con ruolo "presidente" (sola lettura): le regole di
-- scrittura restano invariate perche' sono controllate dal database.

create or replace function mio_contesto_team()
returns table(team_id uuid, team_nome text, team_creato_il timestamptz, team_societa_id uuid, ruolo text, atleta_id uuid,
  stagione_id uuid, stagione_nome text, stagione_stato text, stagione_societa_esiste boolean, stagione_aperta boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  return query
  select * from (
    select tm.team_id, t.nome as team_nome, t.creato_il as team_creato_il, t.societa_id as team_societa_id, tm.ruolo, tm.atleta_id,
      s.id as stagione_id, s.nome as stagione_nome, s.stato as stagione_stato,
      (s.id is not null) as stagione_societa_esiste,
      (s.stato = 'attiva' and tsa.id is not null) as stagione_aperta
    from team_members tm
    join teams t on t.id = tm.team_id
    left join seasons s on s.societa_id = t.societa_id and s.stato = 'attiva'
    left join team_stagioni_attivazioni tsa on tsa.team_id = tm.team_id and tsa.season_id = s.id
    where tm.user_id = auth.uid()
    union
    select t.id, t.nome, t.creato_il, t.societa_id, 'presidente', null::uuid, s.id, s.nome, s.stato,
      (s.id is not null), (s.stato = 'attiva' and tsa.id is not null)
    from teams t
    join societa_presidenti sp on sp.societa_id = t.societa_id and sp.fine_mandato is null
    left join seasons s on s.societa_id = t.societa_id and s.stato = 'attiva'
    left join team_stagioni_attivazioni tsa on tsa.team_id = t.id and tsa.season_id = s.id
    where sp.user_id = auth.uid()
      and t.id not in (select tm2.team_id from team_members tm2 where tm2.user_id = auth.uid())
    union
    select t.id, t.nome, t.creato_il, t.societa_id, 'presidente', null::uuid, s.id, s.nome, s.stato,
      (s.id is not null), (s.stato = 'attiva' and tsa.id is not null)
    from teams t
    left join seasons s on s.societa_id = t.societa_id and s.stato = 'attiva'
    left join team_stagioni_attivazioni tsa on tsa.team_id = t.id and tsa.season_id = s.id
    where is_superuser()
      and t.id not in (select tm3.team_id from team_members tm3 where tm3.user_id = auth.uid())
      and not exists (select 1 from societa_presidenti sp3 where sp3.user_id = auth.uid() and sp3.societa_id = t.societa_id and sp3.fine_mandato is null)
  ) righe
  order by team_creato_il asc;
end;
$function$;
