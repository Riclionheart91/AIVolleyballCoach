-- Gli schemi di gioco li vedono tutti quelli che fanno parte della squadra
-- (allenatori, atlete) e i presidenti, anche quelli di societa' che non hanno
-- una riga diretta nella squadra. La modifica resta riservata agli allenatori
-- (tramite le funzioni salva_schema_gioco e ripristina_schema_gioco).

drop policy if exists "schemi_gioco_select" on schemi_gioco;
create policy "schemi_gioco_select" on schemi_gioco for select
  using (is_team_member(team_id) or is_team_presidente(team_id) or is_superuser());
