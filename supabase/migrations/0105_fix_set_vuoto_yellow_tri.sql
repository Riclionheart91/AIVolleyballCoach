-- Partita YELLOW – POLISPORTIVA TRI (22 nov): il set 3 era un set vuoto (0-0, nessuna azione né formazione)
-- creato per errore; si elimina e il set 4 giocato diventa il 3. (Già applicata sul database.)
do $$
declare
  v_match uuid := '54028f83-22c0-4776-9a8b-dfd93cd9e40d';
  v_vuoto uuid;
begin
  select s.id into v_vuoto from match_sets s
   where s.match_id = v_match and s.numero_set = 3 and s.punti_noi = 0 and s.punti_avversario = 0
     and not exists (select 1 from match_events e where e.set_id = s.id)
     and not exists (select 1 from match_set_lineups l where l.set_id = s.id);
  if v_vuoto is not null and exists (select 1 from match_sets where match_id = v_match and numero_set = 4) then
    delete from match_sets where id = v_vuoto;
    update match_sets set numero_set = 3 where match_id = v_match and numero_set = 4;
  end if;
end $$;
