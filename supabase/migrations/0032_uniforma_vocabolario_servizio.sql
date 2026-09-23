-- 0032 — Vocabolario unico "Servizio" + correzione stato proposte
--
-- PROBLEMA 1 (uniformità): lo stesso fondamentale si chiamava
-- "Battuta" nelle valutazioni e "Servizio" negli eventi partita. Si
-- adotta "Servizio" ovunque. Le tabelle coinvolte erano vuote tranne
-- match_events, che usava già "Servizio": nessun dato da convertire.
--
-- PROBLEMA 2 (bug vero): chiudi_globale() inseriva proposte con stato
-- 'pendente', ma il vincolo di evaluation_proposals ammette
-- 'proposta'. Corretto.

alter table evaluations drop constraint if exists evaluations_fondamentale_check;
update evaluations set fondamentale = 'Servizio' where fondamentale = 'Battuta';
alter table evaluations add constraint evaluations_fondamentale_check
  check (fondamentale in ('Servizio','Ricezione','Attacco','Muro','Difesa'));

alter table evaluation_proposals drop constraint if exists evaluation_proposals_fondamentale_check;
update evaluation_proposals set fondamentale = 'Servizio' where fondamentale = 'Battuta';
alter table evaluation_proposals add constraint evaluation_proposals_fondamentale_check
  check (fondamentale in ('Servizio','Ricezione','Attacco','Muro','Difesa'));

alter table season_baselines drop constraint if exists season_baselines_fondamentale_check;
update season_baselines set fondamentale = 'Servizio' where fondamentale = 'Battuta';
alter table season_baselines add constraint season_baselines_fondamentale_check
  check (fondamentale in ('Servizio','Ricezione','Attacco','Muro','Difesa'));

alter table globale_eventi drop constraint if exists globale_eventi_fondamentale_check;
update globale_eventi set fondamentale = 'Servizio' where fondamentale = 'Battuta';
alter table globale_eventi add constraint globale_eventi_fondamentale_check
  check (fondamentale in ('Servizio','Ricezione','Attacco','Muro','Difesa'));

alter table match_events drop constraint if exists match_events_skill_check;
update match_events set skill = 'Servizio' where skill = 'Battuta';
alter table match_events add constraint match_events_skill_check
  check (skill in ('Servizio','Ricezione','Attacco','Muro','Difesa','Punto_avversario','Punto_nostro'));

create or replace function chiudi_globale(p_globale_id uuid, p_genera_proposte boolean default true)
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_team_id uuid;
  v_riga record;
  v_valore numeric;
  v_create integer := 0;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from globali where id = p_globale_id;
  if v_team_id is null then raise exception 'Globale non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  update globali set stato = 'concluso', concluso_il = now() where id = p_globale_id;
  if not p_genera_proposte then return 0; end if;

  for v_riga in
    select athlete_id, fondamentale,
           count(*) filter (where esito = 'punto')::numeric as punti,
           count(*) filter (where esito = 'errore')::numeric as errori,
           count(*)::integer as totale
    from globale_eventi
    where globale_id = p_globale_id and athlete_id is not null
    group by athlete_id, fondamentale
    having count(*) >= 3
  loop
    v_valore := round(6 + 3 * ((v_riga.punti - v_riga.errori) / v_riga.totale), 1);
    v_valore := least(10, greatest(1, v_valore));

    insert into evaluation_proposals (team_id, athlete_id, fondamentale, valore_proposto, motivazione, stato)
    values (
      v_team_id, v_riga.athlete_id, v_riga.fondamentale, v_valore,
      format('Dal globale del %s: %s punti e %s errori su %s azioni.',
             to_char(now(), 'DD/MM/YYYY'), v_riga.punti::integer, v_riga.errori::integer, v_riga.totale),
      'proposta'
    );
    v_create := v_create + 1;
  end loop;

  return v_create;
end;
$$;
