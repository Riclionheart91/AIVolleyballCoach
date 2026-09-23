-- 0049 — Consolida le regole di lettura rimaste sovrapposte
--
-- Le sovrapposizioni residue erano regole di lettura genuinamente
-- distinte sulla stessa tabella (es. vista "in diretta" durante la
-- partita accanto a quella normale). Vengono unite in una sola
-- condizione con OR — equivalente ai fini dei permessi, ma valutata
-- una sola volta invece di due o tre.

do $$
declare
  tbl text;
  pol record;
  condizione_unita text;
  numero_regole integer;
begin
  foreach tbl in array array['athletes','evaluation_proposals','match_events','match_sets','season_baselines','team_members']
  loop
    select count(*) into numero_regole
    from pg_policies
    where schemaname = 'public' and tablename = tbl and cmd = 'SELECT' and permissive = 'PERMISSIVE';

    if numero_regole < 2 then continue; end if;

    condizione_unita := null;
    for pol in
      select qual from pg_policies
      where schemaname = 'public' and tablename = tbl and cmd = 'SELECT' and permissive = 'PERMISSIVE'
      order by policyname
    loop
      condizione_unita := case when condizione_unita is null
        then '(' || pol.qual || ')'
        else condizione_unita || ' OR (' || pol.qual || ')'
      end;
    end loop;

    begin
      for pol in
        select policyname from pg_policies
        where schemaname = 'public' and tablename = tbl and cmd = 'SELECT' and permissive = 'PERMISSIVE'
      loop
        execute format('drop policy %I on public.%I', pol.policyname, tbl);
      end loop;

      execute format('create policy %I on public.%I for select using (%s)', tbl || '_select_unificata', tbl, condizione_unita);
    exception when others then
      raise notice 'Tabella % saltata: %', tbl, sqlerrm;
    end;
  end loop;
end;
$$;
