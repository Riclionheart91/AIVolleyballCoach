-- 0095 — Presidente che gioca nella squadra = atleta come tutte le altre; visione completa delle analisi
-- concessa (e revocabile) dall'amministratore di sistema.
--
-- REGOLA
--   Se il presidente di una società è anche ATLETA di una squadra (riga in team_members con ruolo 'atleta'),
--   in QUELLA squadra viene trattato come qualsiasi atleta per tutto ciò che riguarda partite e analisi:
--     - durante la partita (in_corso) vede tutte le azioni, come le altre atlete;
--     - dopo la partita e nelle analisi vede solo le proprie azioni e i propri dati;
--   finché l'amministratore di sistema (superuser) non gli attiva la "visione completa delle analisi" per
--   quella squadra. L'amministratore può attivarla e toglierla in qualsiasi momento (es. a fine stagione).
--   Nelle ALTRE squadre della società non cambia nulla: il presidente vede tutto, come oggi.
--   Restano al presidente (anche nella squadra in cui gioca) le funzioni di gestione e l'AI: non dipendono
--   da is_team_staff_visione_piena ma da is_team_presidente, che qui NON si tocca.
--
-- COME
--   1. tabella presidente_visione_analisi: una riga = visione completa concessa a (squadra, presidente);
--   2. is_team_staff_visione_piena() cambia solo per il presidente-atleta senza concessione;
--      allenatore, vice e superuser restano come prima. Questa funzione è il cancello di tutte le regole
--      di lettura su analisi, azioni, valutazioni e schede, quindi basta cambiare lei;
--   3. due funzioni riservate al superuser: elenco dei presidenti-atleta e attivazione/revoca.
--
-- Rollback: in fondo al file (commentato).

-- 1) Concessioni ------------------------------------------------------------------------------------------
create table if not exists presidente_visione_analisi (
  team_id uuid not null references teams(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  concessa_da uuid references auth.users(id) on delete set null,
  concessa_il timestamptz not null default now(),
  primary key (team_id, user_id)
);

-- Nessuna policy: la tabella non si legge né si scrive dal client, solo tramite le funzioni qui sotto.
alter table presidente_visione_analisi enable row level security;
revoke all on table presidente_visione_analisi from anon, authenticated;

-- 2) Cancello della visione piena ---------------------------------------------------------------------------
create or replace function is_team_staff_visione_piena(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select is_team_coach(p_team_id)
    or is_superuser()
    or (
      is_team_presidente(p_team_id)
      and (
        -- presidente che NON gioca in questa squadra: vede tutto, come sempre
        not exists (
          select 1 from team_members tm
          where tm.team_id = p_team_id and tm.user_id = auth.uid() and tm.ruolo = 'atleta'
        )
        -- presidente che gioca qui: vede tutto solo se l'amministratore gliel'ha concesso
        or exists (
          select 1 from presidente_visione_analisi pva
          where pva.team_id = p_team_id and pva.user_id = auth.uid()
        )
      )
    );
$function$;

-- 3) Gestione da parte del superuser -------------------------------------------------------------------------
create or replace function elenca_presidenti_atleti()
returns table(
  team_id uuid, team_nome text, societa_nome text, user_id uuid,
  atleta_nome text, email text, visione_analisi boolean
)
language plpgsql
stable
security definer
set search_path to 'public', 'auth'
as $function$
begin
  if not is_superuser() then raise exception 'Permesso negato'; end if;
  return query
  select tm.team_id, t.nome, s.nome, tm.user_id,
         trim(coalesce(a.nome, '') || ' ' || coalesce(a.cognome, '')),
         u.email::text,
         exists (select 1 from presidente_visione_analisi pva where pva.team_id = tm.team_id and pva.user_id = tm.user_id)
  from team_members tm
  join teams t on t.id = tm.team_id
  join societa s on s.id = t.societa_id
  join societa_presidenti sp on sp.societa_id = t.societa_id and sp.user_id = tm.user_id and sp.fine_mandato is null
  left join athletes a on a.id = tm.atleta_id
  left join auth.users u on u.id = tm.user_id
  where tm.ruolo = 'atleta'
  order by s.nome, t.nome;
end;
$function$;

create or replace function imposta_visione_analisi_presidente(p_team_id uuid, p_user_id uuid, p_concessa boolean)
returns void
language plpgsql
volatile
security definer
set search_path to 'public'
as $function$
begin
  if not is_superuser() then raise exception 'Permesso negato'; end if;

  -- Ha senso solo per un presidente in carica che gioca in quella squadra.
  if not exists (
    select 1
    from team_members tm
    join teams t on t.id = tm.team_id
    join societa_presidenti sp on sp.societa_id = t.societa_id and sp.user_id = tm.user_id and sp.fine_mandato is null
    where tm.team_id = p_team_id and tm.user_id = p_user_id and tm.ruolo = 'atleta'
  ) then
    raise exception 'Questa persona non è presidente-atleta di questa squadra';
  end if;

  if p_concessa then
    insert into presidente_visione_analisi (team_id, user_id, concessa_da)
    values (p_team_id, p_user_id, auth.uid())
    on conflict (team_id, user_id) do nothing;
  else
    delete from presidente_visione_analisi where team_id = p_team_id and user_id = p_user_id;
  end if;
end;
$function$;

revoke execute on function elenca_presidenti_atleti() from public, anon;
revoke execute on function imposta_visione_analisi_presidente(uuid, uuid, boolean) from public, anon;
grant execute on function elenca_presidenti_atleti() to authenticated;
grant execute on function imposta_visione_analisi_presidente(uuid, uuid, boolean) to authenticated;
-- is_team_staff_visione_piena: i permessi esistenti restano (create or replace non li cambia).

-- ── Verifiche (da lanciare dopo, come superuser) ───────────────────────────────────────────────────────────
-- select proname, prosecdef from pg_proc where proname in ('elenca_presidenti_atleti','imposta_visione_analisi_presidente','is_team_staff_visione_piena');
-- select relrowsecurity from pg_class where relname = 'presidente_visione_analisi';   -- true
-- select has_function_privilege('anon', 'imposta_visione_analisi_presidente(uuid,uuid,boolean)', 'execute');  -- false

-- ── Rollback ──────────────────────────────────────────────────────────────────────────────────────────────
-- create or replace function is_team_staff_visione_piena(p_team_id uuid) returns boolean language sql stable security definer
--   set search_path to 'public' as $$ select is_team_coach(p_team_id) or is_team_presidente(p_team_id) or is_superuser(); $$;
-- drop function if exists elenca_presidenti_atleti();
-- drop function if exists imposta_visione_analisi_presidente(uuid, uuid, boolean);
-- drop table if exists presidente_visione_analisi;
