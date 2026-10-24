-- 0082 — Piani individuali di gruppo: le copie assegnate insieme restano collegate.
--  * piani_individuali.gruppo_id: stesso valore per tutte le copie assegnate insieme.
--  * piano_individuale_esercizi.voce_id: stesso valore per lo stesso esercizio nelle varie copie.
--  * piano_individuale_esercizi.personalizzato: l'esercizio e' stato ritoccato per una sola persona;
--    le modifiche di gruppo lo saltano.
alter table piani_individuali add column if not exists gruppo_id uuid;
alter table piano_individuale_esercizi add column if not exists voce_id uuid;
alter table piano_individuale_esercizi add column if not exists personalizzato boolean not null default false;
create index if not exists idx_piani_individuali_gruppo on piani_individuali (gruppo_id) where gruppo_id is not null;
create index if not exists idx_piano_esercizi_voce on piano_individuale_esercizi (voce_id) where voce_id is not null;

-- Collega le copie gia' esistenti: stessa squadra, stesso titolo e stesso obiettivo.
with g as (
  select a.team_id, p.titolo, p.obiettivo, gen_random_uuid() as gruppo
  from piani_individuali p join athletes a on a.id = p.athlete_id
  group by 1, 2, 3 having count(*) > 1
)
update piani_individuali p set gruppo_id = g.gruppo
from athletes a, g
where a.id = p.athlete_id and a.team_id = g.team_id and p.titolo = g.titolo and p.obiettivo = g.obiettivo and p.gruppo_id is null;

-- E gli esercizi uguali dentro il gruppo (stesso nome, stesse indicazioni).
update piano_individuale_esercizi pe
set voce_id = md5(p.gruppo_id::text || coalesce(pe.nome_libero, '') || coalesce(pe.exercise_id::text, '') || pe.indicazioni)::uuid
from piani_individuali p
where p.id = pe.piano_id and p.gruppo_id is not null and pe.voce_id is null;

-- Elenco dei piani di una persona, ora con il gruppo e quante persone lo condividono.
drop function if exists elenca_piani_individuali(uuid);
create or replace function elenca_piani_individuali(p_athlete_id uuid)
returns table(
  id uuid, titolo text, obiettivo text, fondamentale_target text,
  data_inizio date, data_fine date, stato text,
  numero_esercizi integer, svolgimenti_settimana integer, attesi_settimana integer,
  gruppo_id uuid, persone_gruppo integer
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select a.team_id into v_team_id from athletes a where a.id = p_athlete_id;
  if v_team_id is null then raise exception 'Persona non trovata in anagrafica'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or p_athlete_id = mio_atleta_id(v_team_id) or is_superuser()) then
    raise exception 'Permesso negato';
  end if;

  return query
  select p.id, p.titolo, p.obiettivo, p.fondamentale_target,
         p.data_inizio, p.data_fine, p.stato,
         (select count(*)::integer from piano_individuale_esercizi pe where pe.piano_id = p.id),
         (select count(*)::integer from piano_individuale_esercizi pe
            join piano_individuale_svolgimenti sv on sv.piano_esercizio_id = pe.id
           where pe.piano_id = p.id and sv.data >= current_date - 7),
         (select coalesce(sum(pe.volte_a_settimana), 0)::integer from piano_individuale_esercizi pe where pe.piano_id = p.id),
         p.gruppo_id,
         case when p.gruppo_id is null then 1
              else (select count(*)::integer from piani_individuali q where q.gruppo_id = p.gruppo_id) end
  from piani_individuali p
  where p.athlete_id = p_athlete_id
  order by (p.stato = 'attivo') desc, p.data_inizio desc;
end;
$$;
revoke all on function elenca_piani_individuali(uuid) from public, anon;
grant execute on function elenca_piani_individuali(uuid) to authenticated, service_role;

-- Staff: chi e' nel gruppo di un piano e a che punto e' (sedute fatte negli ultimi 7 giorni su quelle previste).
create or replace function avanzamento_gruppo_piano(p_piano_id uuid)
returns table(
  piano_id uuid, athlete_id uuid, nome text, cognome text, stato text,
  svolti integer, attesi integer
)
language plpgsql stable security definer set search_path = public
as $$
#variable_conflict use_column
declare v_team_id uuid; v_gruppo uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select a.team_id, p.gruppo_id into v_team_id, v_gruppo
  from piani_individuali p join athletes a on a.id = p.athlete_id where p.id = p_piano_id;
  if v_team_id is null then raise exception 'Piano non trovato'; end if;
  if not (is_team_staff_visione_piena(v_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;

  return query
  select p.id, a.id, a.nome, a.cognome, p.stato,
         (select count(*)::integer from piano_individuale_esercizi pe
            join piano_individuale_svolgimenti sv on sv.piano_esercizio_id = pe.id
           where pe.piano_id = p.id and sv.data >= current_date - 7),
         (select coalesce(sum(pe.volte_a_settimana), 0)::integer from piano_individuale_esercizi pe where pe.piano_id = p.id)
  from piani_individuali p join athletes a on a.id = p.athlete_id
  where p.id = p_piano_id or (v_gruppo is not null and p.gruppo_id = v_gruppo)
  order by a.cognome, a.nome;
end;
$$;
revoke all on function avanzamento_gruppo_piano(uuid) from public, anon;
grant execute on function avanzamento_gruppo_piano(uuid) to authenticated, service_role;
