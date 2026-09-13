-- 0017 — Fix quota AI chiamata da Edge Function + archivio allenamenti
--
-- BUG: ai_chiamate_residue_oggi() verifica is_team_member(p_team_id),
-- che si basa su auth.uid(). La Edge Function ai-router la chiama con
-- la service role key, dove auth.uid() è NULL: il controllo falliva
-- sempre, la funzione restituiva 0 e il router rispondeva 429 ("limite
-- giornaliero raggiunto") anche alla primissima chiamata. Da qui
-- l'errore "Edge Function returned a non-2xx status code" sulla
-- generazione del piano annuale.

create or replace function ai_chiamate_residue_oggi(p_team_id uuid)
returns integer
language sql stable
security definer
set search_path = public
as $$
  select case
    when auth.role() = 'service_role' or is_team_member(p_team_id) then
      greatest(0, 20 - (select count(*)::integer from ai_call_log where team_id = p_team_id and creato_il >= date_trunc('day', now())))
    else 0
  end;
$$;

alter table trainings add column if not exists archiviato boolean not null default false;
create index if not exists idx_trainings_team_archiviato_data on trainings (team_id, archiviato, data);

create or replace function archivia_allenamenti_passati(p_team_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conteggio integer;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;

  update trainings
  set archiviato = true
  where team_id = p_team_id and archiviato = false and data < now();

  get diagnostics v_conteggio = row_count;
  return v_conteggio;
end;
$$;

revoke execute on function archivia_allenamenti_passati(uuid) from anon;
grant execute on function archivia_allenamenti_passati(uuid) to authenticated;
