-- ============================================================
-- Query diagnostiche — SOLA LETTURA, nessuna modifica ai dati.
-- Da eseguire nel SQL Editor di Supabase dopo aver applicato
-- setup_supabase.sql, per verificare che tutto sia a posto.
-- ============================================================

-- 1. Tabelle presenti (attese: 21)
select table_name from information_schema.tables
where table_schema = 'public' order by 1;

-- 2. RLS attiva su tutte le tabelle di dominio (deve essere sempre "t")
select relname as tabella, relrowsecurity as rls_attiva
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- 3. Elenco di tutte le policy per tabella
select schemaname, tablename, policyname, cmd, roles
from pg_policies where schemaname = 'public'
order by tablename, policyname;

-- 4. Funzioni SECURITY DEFINER senza search_path impostato (atteso: vuoto)
select p.proname, p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ', '), '(nessun search_path!)') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef = true
  and (p.proconfig is null or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
order by p.proname;

-- 5. Funzioni duplicate per nome (sovraccarico non intenzionale — atteso: vuoto,
--    a parte eventuali funzioni realmente pensate con più firme)
select proname, count(*) as numero_firme
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
group by proname having count(*) > 1
order by proname;

-- 6. Vincoli e indici su una tabella chiave, per verificare che nulla sia stato perso
select indexname, indexdef from pg_indexes where tablename = 'team_members';
select conname, contype from pg_constraint where conrelid = 'team_members'::regclass;

-- 7. Trigger presenti sulle tabelle con controlli cross-team
select event_object_table, trigger_name, action_timing, event_manipulation
from information_schema.triggers
where trigger_schema = 'public'
order by event_object_table, trigger_name;

-- 8. Duplicati residui in ai_providers_config (atteso: vuoto)
select team_id, provider_code, count(*)
from ai_providers_config
group by team_id, provider_code having count(*) > 1;

-- 9. Righe che collegano entità di team diversi (atteso: vuoto per tutte)
select 'team_members.atleta_id' as controllo, tm.id
from team_members tm join athletes a on a.id = tm.atleta_id
where tm.team_id <> a.team_id
union all
select 'evaluations', e.id from evaluations e join athletes a on a.id = e.athlete_id where e.team_id <> a.team_id
union all
select 'attendance', att.id from attendance att
  join trainings tr on tr.id = att.training_id join athletes a on a.id = att.athlete_id
  where tr.team_id <> a.team_id
union all
select 'rpe', r.id from rpe r
  join trainings tr on tr.id = r.training_id join athletes a on a.id = r.athlete_id
  where tr.team_id <> a.team_id
union all
select 'match_events.set_id', me.id from match_events me
  join match_sets ms on ms.id = me.set_id where ms.match_id <> me.match_id;

-- 10. Privilegi EXECUTE su anon per le RPC applicative (atteso: vuoto)
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where routine_schema = 'public' and grantee = 'anon'
  and routine_name not like 'st\_%' escape '\';
