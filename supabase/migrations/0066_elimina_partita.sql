-- Eliminazione di una partita (es. partite di prova create per testare).
--
-- La policy RLS "matches_write_coach_delete" consente il DELETE solo a
-- allenatore/vice della squadra, non al superuser. Qui una funzione
-- dedicata con controllo esplicito: allenatore/vice della squadra della
-- partita OPPURE superuser. Il presidente di società resta escluso,
-- coerente con il resto dell'app (sola lettura).
--
-- La cancellazione è a cascata sui dati figli (match_sets, match_events,
-- match_convocati e, tramite i set, formazioni e rimpiazzi libero): le
-- foreign key sono tutte ON DELETE CASCADE. Il lato client chiede sempre
-- conferma prima di chiamarla; l'operazione non è reversibile.

create or replace function elimina_partita(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id into v_team_id from matches where id = p_match_id;
  if v_team_id is null then raise exception 'Partita non trovata'; end if;

  if not (is_team_coach(v_team_id) or is_superuser()) then
    raise exception 'Permesso negato';
  end if;

  delete from matches where id = p_match_id;
end;
$function$;

revoke execute on function elimina_partita(uuid) from public;
revoke execute on function elimina_partita(uuid) from anon;
grant execute on function elimina_partita(uuid) to authenticated;
