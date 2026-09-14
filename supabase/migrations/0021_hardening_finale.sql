-- 0021 — Hardening finale (segnalazioni dell'analizzatore Supabase)
-- 1) search_path fisso sulle ultime due funzioni che ne erano prive.
-- 2) Revoca a "anon" dell'esecuzione di tutte le funzioni SECURITY
--    DEFINER: avevano già controlli interni, ma esporle senza accesso
--    è superfluo. Permesso mantenuto per authenticated e service_role
--    (quest'ultimo serve alle Edge Function).

alter function aggiorna_punteggio_da_evento() set search_path = public;
alter function sono_superuser() set search_path = public;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma, p.prorettype = 'trigger'::regtype as e_trigger
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef = true
  loop
    execute format('revoke all on function %s from public, anon', r.firma);
    if not r.e_trigger then
      execute format('grant execute on function %s to authenticated', r.firma);
      execute format('grant execute on function %s to service_role', r.firma);
    end if;
  end loop;
end;
$$;
