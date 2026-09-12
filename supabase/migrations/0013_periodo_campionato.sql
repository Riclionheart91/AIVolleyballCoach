-- ============================================================
-- 0013 — Periodo del campionato, per l'assegnazione automatica
--
-- Un campionato ora ha un periodo (data inizio/fine facoltative): le
-- partite importate da SportEasy vengono assegnate in automatico al
-- campionato il cui periodo copre la data della partita — sempre
-- modificabile a mano dopo, mai bloccante.
-- ============================================================

alter table campionati add column if not exists data_inizio date;
alter table campionati add column if not exists data_fine date;

-- RPC usata dall'Edge Function di sync per trovare il campionato
-- giusto in base alla data della partita, invece di far girare quella
-- logica lato client/edge (tenendola in un solo posto).
create or replace function trova_campionato_per_data(p_team_id uuid, p_data date)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from campionati
  where team_id = p_team_id and attivo = true
    and (data_inizio is null or data_inizio <= p_data)
    and (data_fine is null or data_fine >= p_data)
  order by (data_inizio is not null and data_fine is not null) desc, creato_il desc
  limit 1;
$$;

revoke execute on function trova_campionato_per_data(uuid, date) from anon;
grant execute on function trova_campionato_per_data(uuid, date) to authenticated;

-- Permette anche alla service role (usata dall'Edge Function
-- sync-sporteasy) di chiamarla, dato che gira fuori dal contesto di
-- un utente autenticato specifico.
grant execute on function trova_campionato_per_data(uuid, date) to service_role;
