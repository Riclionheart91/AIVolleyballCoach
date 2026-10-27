-- 0083 — Rotazione manuale della formazione durante il set ("Ruota di 1").
-- Serve a rimettersi in pari con l'ordine in campo quando si sono perse delle azioni.
-- Puo' farlo chi registra la partita: staff tecnico, superuser e scout ospite (QR o account) della partita in corso.
-- indietro = true riporta la formazione di una posizione all'indietro (per correggere un giro di troppo).
create or replace function ruota_formazione_manuale(p_set_id uuid, p_indietro boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match_id uuid;
  v_team_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  select s.match_id, m.team_id into v_match_id, v_team_id
  from match_sets s join matches m on m.id = s.match_id
  where s.id = p_set_id;
  if v_match_id is null then raise exception 'Set non trovato'; end if;
  if not (is_team_coach(v_team_id) or is_superuser() or is_scout_ospite(v_match_id)) then
    raise exception 'Permesso negato';
  end if;
  if p_indietro then perform ruota_formazione_indietro(p_set_id);
  else perform ruota_formazione(p_set_id);
  end if;
end;
$$;

revoke execute on function ruota_formazione_manuale(uuid, boolean) from public, anon;
grant execute on function ruota_formazione_manuale(uuid, boolean) to authenticated;
