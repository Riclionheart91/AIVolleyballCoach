-- Scouting senza rete: le operazioni della partita (punti, cambi, Libero, time-out, set, chiusura...) restano
-- sul telefono e vengono inviate in ordine appena torna la connessione. Ogni operazione ha un id e il database
-- la applica UNA SOLA VOLTA: se la richiesta arriva due volte (risposta persa, telefono che riprova) la seconda
-- viene riconosciuta e ignorata, invece di segnare un punto o una rotazione in più.
--
-- Questa funzione non cambia le regole di gioco: chiama le stesse funzioni di sempre (registra_evento,
-- cambia_giocatore, ...), con gli stessi controlli di permesso, nella stessa transazione del registro delle
-- operazioni (se l'operazione viene rifiutata non lascia traccia nel registro).

create table if not exists operazioni_scout_applicate (
  op_id uuid primary key,
  match_id uuid not null references matches(id) on delete cascade,
  tipo text not null,
  applicata_da uuid default auth.uid(),
  applicata_il timestamptz not null default now()
);
create index if not exists operazioni_scout_applicate_match_idx on operazioni_scout_applicate (match_id);
alter table operazioni_scout_applicate enable row level security;
revoke all on operazioni_scout_applicate from anon, authenticated;

create or replace function applica_operazione_scout(p_op_id uuid, p_tipo text, p_args jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_match uuid;
  v_team uuid;
  v_set uuid;
  v_id uuid;
  v_chi text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if p_op_id is null then raise exception 'Operazione senza identificativo'; end if;
  p_args := coalesce(p_args, '{}'::jsonb);

  -- La partita su cui si agisce: indicata direttamente o ricavata dal set.
  if nullif(p_args->>'match_id', '') is not null then
    v_match := (p_args->>'match_id')::uuid;
  elsif nullif(p_args->>'set_id', '') is not null then
    select match_id into v_match from match_sets where id = (p_args->>'set_id')::uuid;
  end if;
  if v_match is null then raise exception 'Partita non trovata'; end if;
  select team_id into v_team from matches where id = v_match;
  if v_team is null then raise exception 'Partita non trovata'; end if;
  if not (is_team_scout(v_team) or is_scout_ospite(v_match)) then raise exception 'Permesso negato'; end if;

  -- Già applicata (richiesta ripetuta): niente da fare.
  begin
    insert into operazioni_scout_applicate (op_id, match_id, tipo) values (p_op_id, v_match, p_tipo);
  exception when unique_violation then
    return jsonb_build_object('gia_applicata', true);
  end;

  v_set := nullif(p_args->>'set_id', '')::uuid;

  case p_tipo
    when 'evento' then
      v_id := registra_evento(
        v_match, v_set, p_args->>'skill', nullif(p_args->>'esito', ''),
        nullif(p_args->>'athlete_id', '')::uuid, nullif(p_args->>'qualita', '')
      );
      -- Come faceva l'app: motivo del punto e zone si salvano dopo, e se non riescono l'azione resta valida.
      if nullif(p_args->>'causa', '') is not null then
        begin perform imposta_causa_evento(v_id, p_args->>'causa'); exception when others then null; end;
      end if;
      if nullif(p_args->>'zona_arrivo', '') is not null or nullif(p_args->>'zona_partenza', '') is not null then
        begin
          perform imposta_zone_evento(v_id, nullif(p_args->>'zona_arrivo', '')::int, nullif(p_args->>'zona_partenza', '')::int);
        exception when others then null; end;
      end if;
    when 'annulla' then
      perform annulla_ultimo_evento(v_match);
    when 'cambio' then
      perform cambia_giocatore(v_set, (p_args->>'uscente')::uuid, (p_args->>'entrante')::uuid);
    when 'libero_entra' then
      perform rimpiazza_con_libero(v_set, (p_args->>'libero')::uuid, (p_args->>'titolare')::uuid);
    when 'libero_esce' then
      perform fai_uscire_libero(v_set);
    when 'timeout' then
      v_id := registra_timeout(v_set, p_args->>'squadra');
    when 'timeout_annulla' then
      perform annulla_ultimo_timeout(v_set);
    when 'ruota' then
      perform ruota_formazione_manuale(v_set, coalesce((p_args->>'indietro')::boolean, false));
    when 'nuovo_set' then
      v_id := nuovo_set(v_match);
    when 'torna_set' then
      v_id := torna_al_set_precedente(v_match);
    when 'correggi' then
      v_chi := nullif(p_args->>'chi_serve', '');
      perform correggi_formazione(v_set, p_args->'posizioni', v_chi);
    when 'formazione_iniziale' then
      perform imposta_formazione_iniziale(v_set, p_args->'posizioni', coalesce(nullif(p_args->>'chi_serve', ''), 'noi'));
    when 'avvia' then
      perform avvia_match_confermato(v_match);
    when 'chiudi' then
      perform chiudi_match(v_match);
    when 'convocato' then
      perform aggiungi_convocato(v_match, (p_args->>'athlete_id')::uuid, coalesce((p_args->>'is_libero')::boolean, false));
    when 'regola_libero' then
      perform imposta_regola_libero(
        v_match, nullif(p_args->>'libero', '')::uuid, nullif(p_args->>'titolare_1', '')::uuid, nullif(p_args->>'titolare_2', '')::uuid
      );
    else
      raise exception 'Operazione non riconosciuta: %', p_tipo;
  end case;

  return jsonb_build_object('gia_applicata', false, 'id', v_id);
end;
$$;

revoke execute on function applica_operazione_scout(uuid, text, jsonb) from public, anon;
grant execute on function applica_operazione_scout(uuid, text, jsonb) to authenticated;
