-- Gli schemi di gioco ora si disegnano con dei pallini liberi sul campo:
-- per ogni posizione di rotazione (1-6) un punto {x, y} in frazioni del
-- campo (0-1; y = 0 alla rete, 1 in fondo). Si aggiorna solo la
-- validazione del salvataggio; gli schemi salvati col formato precedente
-- (numero di zona) vengono convertiti in lettura dall'app.

create or replace function salva_schema_gioco(p_team_id uuid, p_fase text, p_variante integer, p_rotazione integer, p_assegnazioni jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chiave integer;
  v_punto jsonb;
  v_x numeric;
  v_y numeric;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_team_coach(p_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  if p_fase not in ('ricezione', 'difesa', 'copertura') then raise exception 'Fase non valida'; end if;
  if p_variante < 1 or p_variante > 2 then raise exception 'Variante non valida'; end if;
  if p_rotazione < 1 or p_rotazione > 6 then raise exception 'Rotazione non valida'; end if;
  if p_assegnazioni is null or jsonb_typeof(p_assegnazioni) <> 'object' then raise exception 'Schema non valido'; end if;

  for v_chiave in 1..6 loop
    v_punto := p_assegnazioni -> v_chiave::text;
    if v_punto is null or jsonb_typeof(v_punto) <> 'object' then raise exception 'Schema incompleto: manca la posizione %', v_chiave; end if;
    if coalesce(jsonb_typeof(v_punto -> 'x'), '') <> 'number' or coalesce(jsonb_typeof(v_punto -> 'y'), '') <> 'number' then raise exception 'Punto non valido per la posizione %', v_chiave; end if;
    v_x := (v_punto ->> 'x')::numeric;
    v_y := (v_punto ->> 'y')::numeric;
    if v_x < 0 or v_x > 1 or v_y < 0 or v_y > 1 then raise exception 'Punto fuori dal campo per la posizione %', v_chiave; end if;
  end loop;

  insert into schemi_gioco (team_id, fase, variante, rotazione, assegnazioni, aggiornato_il, aggiornato_da)
  values (p_team_id, p_fase, p_variante, p_rotazione, p_assegnazioni, now(), auth.uid())
  on conflict (team_id, fase, variante, rotazione)
  do update set assegnazioni = excluded.assegnazioni, aggiornato_il = now(), aggiornato_da = auth.uid();
end;
$$;

revoke execute on function salva_schema_gioco(uuid, text, integer, integer, jsonb) from public, anon;
grant execute on function salva_schema_gioco(uuid, text, integer, integer, jsonb) to authenticated;
