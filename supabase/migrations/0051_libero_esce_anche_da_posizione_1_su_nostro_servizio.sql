-- 0051 — Uscita automatica del Libero anche dalla posizione 1
--
-- gestisci_libero_dopo_rotazione() viene chiamata SOLO nel ramo dove
-- la rotazione ci ha appena fatto conquistare il servizio. In quel
-- preciso momento, se il Libero è finito in posizione 1, sta per
-- dover servire: va fatto uscire come già succede per la prima linea.

create or replace function gestisci_libero_dopo_rotazione(p_set_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_posizione integer;
begin
  select l.posizione into v_posizione
  from rimpiazzi_libero r
  join match_set_lineups l on l.set_id = r.set_id and l.athlete_id = r.libero_id and l.in_campo = true
  where r.set_id = p_set_id and r.uscito_il is null
  limit 1;

  if v_posizione is not null and v_posizione in (1, 2, 3, 4) then
    perform fai_uscire_libero(p_set_id);
  end if;
end;
$$;
