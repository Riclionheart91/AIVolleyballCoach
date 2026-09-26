-- ============================================================
-- 0053 — mio_contesto_team() espone team_societa_id
--
-- Il presidente può essere anche allenatore/atleta diretto di una
-- squadra della propria società (caso esplicitamente richiesto: "il
-- presidente è anche giocatore"). Quando visualizza QUELLA squadra,
-- ruolo riflette il ruolo diretto (es. "allenatore"), non "presidente":
-- i permessi da presidente lato client (in particolare la gestione
-- stagioni, riservata al presidente) andavano quindi persi per quella
-- squadra pur essendo l'account comunque presidente della società a cui
-- appartiene. Esponendo team_societa_id, il client può riconoscere i
-- permessi da presidente per QUALSIASI squadra della propria società,
-- indipendentemente dal ruolo diretto posseduto su quella specifica
-- squadra (vedi src/context/AuthContext.tsx, ePresidenteDiQuestaSquadra).
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
      s.id, s.nome, s.stato, (s.stato = 'attiva')
    from team_members tm
    join teams t on t.id = tm.team_id
    left join seasons s on s.team_id = tm.team_id and s.stato = 'attiva'
    where tm.user_id = auth.uid()
  union
  select t.id, t.nome, t.creato_il, t.societa_id, 'presidente', null::uuid,
    s.id, s.nome, s.stato, (s.stato = 'attiva')
  from teams t
  join societa_presidenti sp on sp.societa_id = t.societa_id and sp.fine_mandato is null
  left join seasons s on s.team_id = t.id and s.stato = 'attiva'
  where sp.user_id = auth.uid()
    and t.id not in (select tm2.team_id from team_members tm2 where tm2.user_id = auth.uid())
  order by team_creato_il asc;
end;
$$;
