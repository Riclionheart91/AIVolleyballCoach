-- 0089 — Causa dei punti "diretti" (senza giocatrice): +1 NOI / +1 LORO.
-- causa su match_events, valorizzata subito dopo la registrazione (come le zone):
--   Punto_avversario: punto_diretto_loro | errore_nostro
--   Punto_nostro:     errore_loro | punto_diretto_nostro | muro_nostro | difesa_nostro
-- Gli eventi senza causa (storici) restano com'erano.

alter table match_events add column if not exists causa text;
alter table match_events add constraint match_events_causa_check check (
  causa is null
  or (skill = 'Punto_avversario' and causa in ('punto_diretto_loro', 'errore_nostro'))
  or (skill = 'Punto_nostro' and causa in ('errore_loro', 'punto_diretto_nostro', 'muro_nostro', 'difesa_nostro'))
);

create or replace function imposta_causa_evento(p_event_id uuid, p_causa text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_match_id uuid; v_team_id uuid; v_stato text; v_skill text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select e.match_id, m.team_id, m.stato, e.skill into v_match_id, v_team_id, v_stato, v_skill
  from match_events e join matches m on m.id = e.match_id where e.id = p_event_id;
  if v_match_id is null then raise exception 'Evento non trovato'; end if;
  if not (is_team_scout(v_team_id) or is_scout_ospite(v_match_id)) then raise exception 'Permesso negato'; end if;
  if v_stato <> 'in_corso' then raise exception 'La partita non è in corso'; end if;
  if v_skill not in ('Punto_nostro', 'Punto_avversario') then raise exception 'La causa si indica solo per i punti diretti'; end if;
  update match_events set causa = p_causa where id = p_event_id;
end;
$function$;

revoke execute on function imposta_causa_evento(uuid, text) from public, anon;
grant execute on function imposta_causa_evento(uuid, text) to authenticated;
