-- 0040 — Fasi dell'allenamento + lavoro parallelo per ruolo

alter table training_exercises add column if not exists fase text
  check (fase in ('riscaldamento','tecnico','situazionale','defaticamento'));
alter table training_exercises add column if not exists ruolo_target text;

update training_exercises set fase = 'tecnico' where fase is null;

alter table exercises add column if not exists fase_consigliata text
  check (fase_consigliata in ('riscaldamento','tecnico','situazionale','defaticamento'));

update exercises set fase_consigliata = 'riscaldamento'
  where fase_consigliata is null and (categoria ilike '%prepar%' or categoria ilike '%fisic%' or categoria ilike '%atletic%');
update exercises set fase_consigliata = 'tecnico' where fase_consigliata is null;

create or replace function pesi_fasi_per_data(p_team_id uuid, p_data date, p_durata_totale integer default 120)
returns table(fase text, minuti_consigliati integer, quota integer, motivo text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_tipo text;
  v_nome text;
  q_risc integer; q_tec integer; q_sit integer; q_def integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_member(p_team_id) then raise exception 'Permesso negato'; end if;

  select b.tipo, b.nome into v_tipo, v_nome
  from blocchi_piano b
  join piani_annuali pa on pa.id = b.piano_id
  where pa.team_id = p_team_id and p_data between b.data_inizio and b.data_fine
  order by b.data_inizio desc limit 1;

  if v_tipo = 'preparazione_generale' then
    q_risc := 40; q_tec := 40; q_sit := 12; q_def := 8;
  elsif v_tipo = 'preparazione_specifica' then
    q_risc := 25; q_tec := 50; q_sit := 17; q_def := 8;
  elsif v_tipo = 'pre_competitiva' then
    q_risc := 20; q_tec := 40; q_sit := 32; q_def := 8;
  elsif v_tipo = 'competitiva' then
    q_risc := 20; q_tec := 30; q_sit := 42; q_def := 8;
  elsif v_tipo = 'scarico' then
    q_risc := 35; q_tec := 30; q_sit := 20; q_def := 15;
  elsif v_tipo = 'transizione' then
    q_risc := 45; q_tec := 25; q_sit := 20; q_def := 10;
  else
    q_risc := 25; q_tec := 40; q_sit := 27; q_def := 8;
  end if;

  return query
  select * from (values
    ('riscaldamento', round(p_durata_totale * q_risc / 100.0)::integer, q_risc,
     coalesce('Periodo: ' || v_nome, 'Nessun piano annuale per questa data: ripartizione equilibrata')),
    ('tecnico', round(p_durata_totale * q_tec / 100.0)::integer, q_tec,
     coalesce('Periodo: ' || v_nome, 'Nessun piano annuale per questa data: ripartizione equilibrata')),
    ('situazionale', round(p_durata_totale * q_sit / 100.0)::integer, q_sit,
     coalesce('Periodo: ' || v_nome, 'Nessun piano annuale per questa data: ripartizione equilibrata')),
    ('defaticamento', round(p_durata_totale * q_def / 100.0)::integer, q_def,
     coalesce('Periodo: ' || v_nome, 'Nessun piano annuale per questa data: ripartizione equilibrata'))
  ) as t(fase, minuti_consigliati, quota, motivo);
end;
$$;

revoke all on function pesi_fasi_per_data(uuid, date, integer) from public, anon;
grant execute on function pesi_fasi_per_data(uuid, date, integer) to authenticated, service_role;
