-- 0046 — Elimina la sovrapposizione di regole di sicurezza sulle letture
--
-- Quasi ogni tabella aveva una regola dedicata alla lettura e una
-- seconda "per tutto" che in Postgres copre ANCHE la lettura: ogni
-- interrogazione veniva verificata da entrambe. Dove esiste già una
-- regola di lettura dedicata, la regola "per tutto" viene ristretta a
-- scrittura/modifica/cancellazione soltanto, leggendo le condizioni
-- originali direttamente dal catalogo di Postgres.

do $$
declare
  pol record;
  ha_select_dedicata boolean;
  ruoli_txt text;
begin
  for pol in
    select schemaname, tablename, policyname, roles, qual, with_check
    from pg_policies
    where schemaname = 'public' and cmd = 'ALL' and permissive = 'PERMISSIVE'
  loop
    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = pol.tablename
        and cmd = 'SELECT' and permissive = 'PERMISSIVE'
        and policyname <> pol.policyname
    ) into ha_select_dedicata;

    if ha_select_dedicata then
      ruoli_txt := array_to_string(pol.roles, ', ');

      begin
        execute format('drop policy %I on %I.%I', pol.policyname, pol.schemaname, pol.tablename);

        execute format(
          'create policy %I on %I.%I for insert to %s with check (%s)',
          pol.policyname || '_insert', pol.schemaname, pol.tablename, ruoli_txt,
          coalesce(pol.with_check, pol.qual)
        );
        execute format(
          'create policy %I on %I.%I for update to %s using (%s) with check (%s)',
          pol.policyname || '_update', pol.schemaname, pol.tablename, ruoli_txt,
          pol.qual, coalesce(pol.with_check, pol.qual)
        );
        execute format(
          'create policy %I on %I.%I for delete to %s using (%s)',
          pol.policyname || '_delete', pol.schemaname, pol.tablename, ruoli_txt,
          pol.qual
        );
      exception when others then
        raise notice 'Tabella % (regola %) saltata: %', pol.tablename, pol.policyname, sqlerrm;
      end;
    end if;
  end loop;
end;
$$;
