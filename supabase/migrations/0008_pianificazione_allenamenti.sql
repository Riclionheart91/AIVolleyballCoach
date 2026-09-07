-- ============================================================
-- 0008 — Pianificazione allenamenti
--
-- Aggiunge quanto mancava per pianificare davvero una sessione (non
-- solo titolo+data): argomento/tema, e per ogni esercizio inserito la
-- durata in minuti — così si vede il totale della sessione mentre la
-- si costruisce. Nessuna tabella nuova: additivo su trainings e
-- training_exercises già esistenti.
-- ============================================================

alter table trainings add column if not exists argomento text;
alter table trainings add column if not exists durata_totale_minuti integer;

alter table training_exercises add column if not exists durata_minuti integer;

-- RPC per la generazione via AI: non genera nulla lato database (serve
-- l'Edge Function ai-router per il vero e proprio prompt), ma questa
-- funzione applica in un colpo solo la proposta che l'allenatore ha
-- confermato — sostituendo l'elenco esercizi della sessione con quello
-- proposto/modificato, invece di più insert separate dal client.
create or replace function imposta_piano_allenamento(
  p_training_id uuid,
  p_argomento text,
  p_esercizi jsonb -- [{"exercise_id": "...", "durata_minuti": 10, "note": "...", "ordine": 0}, ...]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_esercizio jsonb;
  v_totale integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select team_id into v_team_id from trainings where id = p_training_id;
  if v_team_id is null then raise exception 'Allenamento non trovato'; end if;
  if not is_team_coach(v_team_id) then raise exception 'Permesso negato'; end if;

  delete from training_exercises where training_id = p_training_id;

  select coalesce(sum((e->>'durata_minuti')::integer), 0) into v_totale
  from jsonb_array_elements(p_esercizi) e;

  for v_esercizio in select * from jsonb_array_elements(p_esercizi)
  loop
    if not exists (select 1 from exercises where id = (v_esercizio->>'exercise_id')::uuid and team_id = v_team_id) then
      raise exception 'Uno degli esercizi indicati non appartiene a questa squadra';
    end if;
    insert into training_exercises (training_id, exercise_id, durata_minuti, note, ordine)
    values (
      p_training_id,
      (v_esercizio->>'exercise_id')::uuid,
      (v_esercizio->>'durata_minuti')::integer,
      coalesce(v_esercizio->>'note', ''),
      coalesce((v_esercizio->>'ordine')::integer, 0)
    );
  end loop;

  update trainings set argomento = p_argomento, durata_totale_minuti = v_totale where id = p_training_id;
end;
$$;

revoke execute on function imposta_piano_allenamento(uuid, text, jsonb) from anon;
grant execute on function imposta_piano_allenamento(uuid, text, jsonb) to authenticated;
