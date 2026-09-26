-- ============================================================
-- 0052 — fix nomi colonne di mio_contesto_team()
--
-- Bug: la riscrittura per il modello società (applicata live come
-- "societa_e_presidente_di_club_v2", mai mirrorata localmente) aveva
-- rinominato per errore le colonne di output da team_nome/team_creato_il
-- a nome/creato_il. Il client (src/context/AuthContext.tsx) legge ancora
-- r.team_nome e r.team_creato_il: risultato, team.nome era sempre
-- undefined per OGNI riga (non solo per il ramo sintetico presidente).
--
-- Sintomi lato utente causati da questo bug:
--  - "vedo solo i ruoli che ho": le card squadra in seleziona-squadra.tsx
--    mostravano solo l'etichetta del ruolo, il nome era vuoto;
--  - "il presidente appare come se fosse una squadra": la card per una
--    squadra vista solo tramite la presidenza di società (es. WHITE,
--    senza riga diretta in team_members) aveva nome vuoto ed etichetta
--    "Presidente" sotto — sembrava una scheda a sé, non una squadra reale.
-- ============================================================

drop function if exists mio_contesto_team();

create or replace function mio_contesto_team()
returns table(
  team_id uuid,
  team_nome text,
  team_creato_il timestamptz,
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
    select tm.team_id, t.nome, t.creato_il, tm.ruolo, tm.atleta_id,
      s.id, s.nome, s.stato, (s.stato = 'attiva')
    from team_members tm
    join teams t on t.id = tm.team_id
    left join seasons s on s.team_id = tm.team_id and s.stato = 'attiva'
    where tm.user_id = auth.uid()
  union
  select t.id, t.nome, t.creato_il, 'presidente', null::uuid,
    s.id, s.nome, s.stato, (s.stato = 'attiva')
  from teams t
  join societa_presidenti sp on sp.societa_id = t.societa_id and sp.fine_mandato is null
  left join seasons s on s.team_id = t.id and s.stato = 'attiva'
  where sp.user_id = auth.uid()
    and t.id not in (select tm2.team_id from team_members tm2 where tm2.user_id = auth.uid())
  order by team_creato_il asc;
end;
$$;
