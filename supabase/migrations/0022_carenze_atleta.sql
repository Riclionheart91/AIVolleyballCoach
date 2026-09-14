-- 0022 — Carenze per atleta, base per gli esercizi correttivi mirati
-- Restituisce i fondamentali più deboli secondo le valutazioni recenti:
-- è il dato su cui l'AI costruisce esercizi individuali invece di
-- lavori generici uguali per tutte.

create or replace function carenze_atleta(p_athlete_id uuid, p_quante integer default 3)
returns table(fondamentale text, media numeric, numero_valutazioni integer)
language plpgsql stable security definer set search_path = public
as $$
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from athletes where id = p_athlete_id;
  if v_team_id is null then raise exception 'Atleta non trovata'; end if;

  -- Stessa regola di privacy già in vigore altrove: lo staff con visione
  -- piena vede tutte, un'atleta solo le proprie carenze.
  if not (is_team_staff_visione_piena(v_team_id) or p_athlete_id = mio_atleta_id(v_team_id)) then
    raise exception 'Permesso negato';
  end if;

  return query
    select e.fondamentale, round(avg(e.punteggio), 1), count(*)::integer
    from evaluations e
    where e.athlete_id = p_athlete_id
      and e.data_valutazione >= now() - interval '120 days'
    group by e.fondamentale
    order by avg(e.punteggio) asc
    limit greatest(1, p_quante);
end;
$$;

revoke all on function carenze_atleta(uuid, integer) from public, anon;
grant execute on function carenze_atleta(uuid, integer) to authenticated;
grant execute on function carenze_atleta(uuid, integer) to service_role;
