-- 0090 — (1) La regola del Libero torna sui centrali di partenza a ogni nuovo set; (2) chi rientra dopo un cambio non puo' piu' uscire.
--
-- 1) match_libero_regola ricorda i centrali "base" (quelli indicati dall'allenatore). Durante un set un cambio sposta
--    l'associazione sul sostituto; quando in un nuovo set un centrale base e' in formazione di partenza, l'associazione
--    torna a lui (trigger su match_set_lineups).
-- 2) cambia_giocatore: chi e' rientrata al posto di chi l'aveva sostituita non puo' piu' uscire nello stesso set
--    (una uscita e un rientro per titolare). Per correggere un errore c'e' "Formazione".
-- Applicata a pezzi dall'editor (le funzioni con "delete from" non passano dallo strumento di migrazione).

alter table match_libero_regola add column if not exists titolare_1_base uuid;
alter table match_libero_regola add column if not exists titolare_2_base uuid;

update match_libero_regola r set
  titolare_1_base = coalesce((select l.sostituisce_id from match_set_lineups l join match_sets s on s.id = l.set_id
    where s.match_id = r.match_id and l.athlete_id = r.titolare_1 and l.sostituisce_id is not null order by s.numero_set limit 1), r.titolare_1),
  titolare_2_base = coalesce((select l.sostituisce_id from match_set_lineups l join match_sets s on s.id = l.set_id
    where s.match_id = r.match_id and l.athlete_id = r.titolare_2 and l.sostituisce_id is not null order by s.numero_set limit 1), r.titolare_2)
where r.titolare_1_base is null and r.titolare_2_base is null;

-- imposta_regola_libero: come prima, ma registra anche i centrali "base".
-- (definizione completa nel database: stessa di 0076 con titolare_1_base/titolare_2_base valorizzati)

create or replace function riallinea_regola_libero_a_inizio_set()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.posizione_iniziale is not null and NEW.in_campo then
    update match_libero_regola r set
      titolare_1 = case when r.titolare_1_base = NEW.athlete_id then NEW.athlete_id else r.titolare_1 end,
      titolare_2 = case when r.titolare_2_base = NEW.athlete_id then NEW.athlete_id else r.titolare_2 end
    where r.match_id = (select s.match_id from match_sets s where s.id = NEW.set_id)
      and NEW.athlete_id in (r.titolare_1_base, r.titolare_2_base);
  end if;
  return NEW;
end;
$function$;

create trigger trg_riallinea_regola_libero after insert on match_set_lineups
for each row execute function riallinea_regola_libero_a_inizio_set();

-- cambia_giocatore: aggiunto il controllo "chi e' rientrata non puo' piu' uscire" (vedi la definizione nel database,
-- stessa di 0086 piu' v_uscente_rientrato).
