-- 0044 — Richiusura completa: due funzioni erano tornate accessibili
-- senza accesso, e va ripetuto il giro su tutte quelle create dopo
-- l'ultimo controllo, che non erano coperte.
--
-- CAUSA: ogni volta che una funzione viene creata per la prima volta,
-- Postgres le assegna di default il permesso di esecuzione a PUBLIC,
-- che include gli utenti non autenticati. La richiusura fatta a suo
-- tempo copriva solo le funzioni esistenti in quel momento.

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as firma, p.prorettype = 'trigger'::regtype as e_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
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
