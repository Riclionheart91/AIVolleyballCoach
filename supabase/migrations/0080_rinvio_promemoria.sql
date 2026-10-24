-- Rinvio dei promemoria "Valutazioni da aggiornare" e "Piano annuale da rivedere".
-- L'allenatore (o il vice) li posticipa alla data del ciclo successivo; fino ad allora non compaiono piu'
-- nelle notifiche. Il rinvio vale per tutta la squadra e scade da solo alla data indicata.

alter table teams add column if not exists valutazioni_rinviate_fino_a date;
alter table teams add column if not exists piano_rinviato_fino_a date;

create or replace function leggi_rinvii_promemoria(p_team_id uuid)
returns table (valutazioni_fino_a date, piano_fino_a date, giorni_ciclo_valutazione integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_staff_visione_piena(p_team_id) then raise exception 'Permesso negato'; end if;
  return query
    select t.valutazioni_rinviate_fino_a, t.piano_rinviato_fino_a, coalesce(t.giorni_ciclo_valutazione, 30)
    from teams t where t.id = p_team_id;
end;
$$;

-- p_fino_a null = riattiva subito il promemoria.
create or replace function rinvia_promemoria(p_team_id uuid, p_tipo text, p_fino_a date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_coach(p_team_id) then raise exception 'Permesso negato'; end if;
  if p_tipo not in ('valutazioni', 'piano_annuale') then raise exception 'Promemoria non valido'; end if;
  if p_fino_a is not null and (p_fino_a < current_date or p_fino_a > current_date + 400) then
    raise exception 'Data di rinvio non valida';
  end if;
  if p_tipo = 'valutazioni' then
    update teams set valutazioni_rinviate_fino_a = p_fino_a where id = p_team_id;
  else
    update teams set piano_rinviato_fino_a = p_fino_a where id = p_team_id;
  end if;
end;
$$;

revoke execute on function leggi_rinvii_promemoria(uuid) from public, anon;
revoke execute on function rinvia_promemoria(uuid, text, date) from public, anon;
grant execute on function leggi_rinvii_promemoria(uuid) to authenticated;
grant execute on function rinvia_promemoria(uuid, text, date) to authenticated;
