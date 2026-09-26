-- ============================================================
-- 0060 — CORREZIONE CRITICA: mio_contesto_team() falliva per TUTTI gli
-- utenti con "ERROR: invalid UNION/INTERSECT/EXCEPT ORDER BY clause".
-- La UNION tra le righe dirette e quelle sintetiche del presidente non
-- può essere ordinata con "order by team_creato_il" perché quel nome
-- non è una colonna di output della query combinata, solo un nome di
-- parametro OUT della funzione. Si racchiude la UNION in una subquery
-- con alias e si ordina quella.
-- ============================================================

drop function if exists mio_contesto_team();

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
  ) righe
  order by team_creato_il asc;
end;
$$;
