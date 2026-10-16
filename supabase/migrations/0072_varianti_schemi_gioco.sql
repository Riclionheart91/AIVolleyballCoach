-- Varianti degli schemi di gioco: per ogni fase si possono tenere due schemi
-- fra cui passare durante la partita (es. difesa con muro diagonale oppure
-- muro lungo linea). Gli schemi gia' salvati restano la variante 1.

alter table schemi_gioco
  add column if not exists variante smallint not null default 1 check (variante between 1 and 2);

alter table schemi_gioco drop constraint if exists schemi_gioco_team_id_fase_rotazione_key;
alter table schemi_gioco drop constraint if exists schemi_gioco_team_fase_variante_rotazione_key;
alter table schemi_gioco add constraint schemi_gioco_team_fase_variante_rotazione_key unique (team_id, fase, variante, rotazione);

drop function if exists salva_schema_gioco(uuid, text, integer, jsonb);
drop function if exists ripristina_schema_gioco(uuid, text, integer);

create or replace function salva_schema_gioco(p_team_id uuid, p_fase text, p_variante integer, p_rotazione integer, p_assegnazioni jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chiave integer;
  v_zona integer;
  v_zone integer[] := '{}';
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_team_coach(p_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if p_fase not in ('ricezione', 'difesa', 'copertura') then raise exception 'Fase non valida'; end if;
  if p_variante < 1 or p_variante > 2 then raise exception 'Variante non valida'; end if;
  if p_rotazione < 1 or p_rotazione > 6 then raise exception 'Rotazione non valida'; end if;
  if p_assegnazioni is null or jsonb_typeof(p_assegnazioni) <> 'object' then raise exception 'Schema non valido'; end if;

  for v_chiave in 1..6 loop
    if (p_assegnazioni ->> v_chiave::text) is null then raise exception 'Schema incompleto: manca la posizione %', v_chiave; end if;
    v_zona := (p_assegnazioni ->> v_chiave::text)::integer;
    if v_zona < 1 or v_zona > 6 then raise exception 'Zona non valida: %', v_zona; end if;
    if v_zona = any (v_zone) then raise exception 'Due posizioni nella stessa zona (%)', v_zona; end if;
    v_zone := v_zone || v_zona;
  end loop;

  insert into schemi_gioco (team_id, fase, variante, rotazione, assegnazioni, aggiornato_il, aggiornato_da)
  values (p_team_id, p_fase, p_variante, p_rotazione, p_assegnazioni, now(), auth.uid())
  on conflict (team_id, fase, variante, rotazione)
  do update set assegnazioni = excluded.assegnazioni, aggiornato_il = now(), aggiornato_da = auth.uid();
end;
$$;

revoke execute on function salva_schema_gioco(uuid, text, integer, integer, jsonb) from public, anon;
grant execute on function salva_schema_gioco(uuid, text, integer, integer, jsonb) to authenticated;

create or replace function ripristina_schema_gioco(p_team_id uuid, p_fase text, p_variante integer, p_rotazione integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_team_coach(p_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  delete from schemi_gioco where team_id = p_team_id and fase = p_fase and variante = p_variante and rotazione = p_rotazione;
end;
$$;

revoke execute on function ripristina_schema_gioco(uuid, text, integer, integer) from public, anon;
grant execute on function ripristina_schema_gioco(uuid, text, integer, integer) to authenticated;
