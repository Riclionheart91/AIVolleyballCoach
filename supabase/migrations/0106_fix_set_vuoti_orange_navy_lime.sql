-- Elimina i set vuoti (0-0, nessuna azione, già chiusi) creati per errore in 4 partite e rinumera i set rimasti.
-- ORANGE–AD ASTRA (set 4), NAVY–Acli Cinisello (set 2, 3, 5, 7), ORANGE–LIME (set 3), LIME–ALLIANZ (set 2). (Già applicata sul database.)
do $$
declare
  v_match uuid;
begin
  foreach v_match in array array[
    '7258de3f-b538-4f2b-adec-b292a029ec36',
    '79154b29-7bbc-4ebd-81c7-23a5cb0a8d24',
    '13701ae8-f4cf-400c-97b9-ad67033813aa',
    'bb9a70f8-b875-4cc2-9eaf-8ccbd8d1db39'
  ]::uuid[] loop
    delete from match_sets s
     where s.match_id = v_match and s.concluso = true and s.punti_noi = 0 and s.punti_avversario = 0
       and not exists (select 1 from match_events e where e.set_id = s.id);
    update match_sets set numero_set = numero_set + 100 where match_id = v_match;
    update match_sets s set numero_set = r.nuovo
      from (select id, row_number() over (order by numero_set) as nuovo from match_sets where match_id = v_match) r
     where s.id = r.id;
  end loop;
end $$;
