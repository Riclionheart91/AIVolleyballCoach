-- ============================================================
-- 0056 — Modello stagione a livello di società (fase RPC)
-- ============================================================

drop function if exists attiva_stagione(uuid);
drop function if exists concludi_stagione(uuid);
drop function if exists genera_baseline_stagione(uuid);

create or replace function prossimo_nome_stagione(p_nome_attuale text)
returns text
language plpgsql
immutable
as $$
declare
  v_parti text[];
begin
  v_parti := regexp_match(p_nome_attuale, '^\s*(\d{4})\s*/\s*(\d{4})\s*$');
  if v_parti is null then
    return p_nome_attuale || ' (nuova)';
  end if;
  return (v_parti[1]::int + 1) || '/' || (v_parti[2]::int + 1);
end;
$$;

create or replace function apri_prima_stagione_societa(p_societa_id uuid, p_nome text, p_data_apertura date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season_id uuid;
  v_nome_pulito text;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_societa_presidente(p_societa_id) then raise exception 'Permesso negato: solo il presidente della società'; end if;
  if exists (select 1 from seasons where societa_id = p_societa_id and stato = 'attiva') then
    raise exception 'Esiste già una stagione attiva per questa società';
  end if;

  v_nome_pulito := trim(p_nome);
  if v_nome_pulito = '' or v_nome_pulito is null then raise exception 'Il nome della stagione non può essere vuoto'; end if;

  insert into seasons (societa_id, nome, stato, data_apertura, creata_da)
  values (p_societa_id, v_nome_pulito, 'attiva', p_data_apertura, auth.uid())
  returning id into v_season_id;

  return v_season_id;
end;
$$;

create or replace function chiudi_e_apri_nuova_stagione_societa(p_societa_id uuid, p_nome_nuova text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vecchia seasons%rowtype;
  v_nuovo_nome text;
  v_nuovo_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_societa_presidente(p_societa_id) then raise exception 'Permesso negato: solo il presidente della società'; end if;

  select * into v_vecchia from seasons where societa_id = p_societa_id and stato = 'attiva';
  if v_vecchia.id is null then raise exception 'Nessuna stagione attiva da chiudere: usa apri_prima_stagione_societa'; end if;

  update seasons set stato = 'conclusa', data_chiusura = coalesce(data_chiusura, current_date) where id = v_vecchia.id;

  v_nuovo_nome := coalesce(nullif(trim(p_nome_nuova), ''), prossimo_nome_stagione(v_vecchia.nome));

  insert into seasons (societa_id, nome, stato, data_apertura, creata_da)
  values (p_societa_id, v_nuovo_nome, 'attiva', current_date, auth.uid())
  returning id into v_nuovo_id;

  return v_nuovo_id;
end;
$$;

create or replace function genera_baseline_stagione(p_team_id uuid, p_season_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_data_apertura date;
  v_creati integer := 0;
  v_fondamentale text;
  v_riferimento record;
begin
  select data_apertura into v_data_apertura from seasons where id = p_season_id;
  if v_data_apertura is null then raise exception 'Stagione non trovata: %', p_season_id; end if;
  if not (is_team_coach(p_team_id) or is_team_presidente(p_team_id)) then raise exception 'Permesso negato'; end if;

  for v_fondamentale in select unnest(array['Servizio','Ricezione','Attacco','Muro','Difesa'])
  loop
    for v_riferimento in
      select distinct on (e.athlete_id) e.athlete_id, e.id as valutazione_id, e.punteggio
      from evaluations e
      join athletes a on a.id = e.athlete_id
      where e.fondamentale = v_fondamentale
        and a.team_id = p_team_id
        and a.status = 'attiva'
        and e.data_valutazione::date <= v_data_apertura
        and not exists (
          select 1 from season_baselines sb
          where sb.season_id = p_season_id and sb.athlete_id = e.athlete_id and sb.fondamentale = v_fondamentale
        )
      order by e.athlete_id, e.data_valutazione desc
    loop
      insert into season_baselines (season_id, athlete_id, fondamentale, valore_baseline, valutazione_id_riferimento, creata_da)
      values (p_season_id, v_riferimento.athlete_id, v_fondamentale, v_riferimento.punteggio, v_riferimento.valutazione_id, auth.uid());
      v_creati := v_creati + 1;
    end loop;
  end loop;

  return v_creati;
end;
$$;

create or replace function attiva_squadra_in_stagione(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_societa_id uuid;
  v_season_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_presidente(p_team_id) then raise exception 'Permesso negato: solo il presidente della società può attivare una squadra'; end if;

  select societa_id into v_societa_id from teams where id = p_team_id;
  select id into v_season_id from seasons where societa_id = v_societa_id and stato = 'attiva';
  if v_season_id is null then raise exception 'Nessuna stagione attiva per questa società: aprine prima una'; end if;

  insert into team_stagioni_attivazioni (team_id, season_id, attivata_da)
  values (p_team_id, v_season_id, auth.uid())
  on conflict (team_id, season_id) do nothing;

  begin
    perform genera_baseline_stagione(p_team_id, v_season_id);
  exception when others then
    raise notice 'Baseline non generata automaticamente per team % stagione %: %', p_team_id, v_season_id, sqlerrm;
  end;
end;
$$;

create or replace function disattiva_squadra_in_stagione(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_societa_id uuid;
  v_season_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_presidente(p_team_id) then raise exception 'Permesso negato'; end if;

  select societa_id into v_societa_id from teams where id = p_team_id;
  select id into v_season_id from seasons where societa_id = v_societa_id and stato = 'attiva';
  if v_season_id is null then return; end if;

  delete from team_stagioni_attivazioni where team_id = p_team_id and season_id = v_season_id;
end;
$$;

create or replace function sposta_atleta_squadra(p_athlete_id uuid, p_team_id_nuovo uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_vecchio uuid;
  v_societa_vecchia uuid;
  v_societa_nuova uuid;
  v_stagione_attiva uuid;
  v_user_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;

  select team_id into v_team_vecchio from athletes where id = p_athlete_id;
  if v_team_vecchio is null then raise exception 'Atleta non trovato'; end if;

  select societa_id into v_societa_vecchia from teams where id = v_team_vecchio;
  select societa_id into v_societa_nuova from teams where id = p_team_id_nuovo;

  if not is_societa_presidente(v_societa_vecchia) then raise exception 'Permesso negato: solo il presidente della società'; end if;
  if v_societa_nuova is distinct from v_societa_vecchia then
    raise exception 'Puoi spostare un atleta solo tra squadre della stessa società';
  end if;
  if v_team_vecchio = p_team_id_nuovo then
    raise exception 'La squadra di destinazione coincide con quella attuale';
  end if;

  select id into v_stagione_attiva from seasons where societa_id = v_societa_nuova and stato = 'attiva';
  if v_stagione_attiva is not null and exists (
    select 1 from team_stagioni_attivazioni where team_id = p_team_id_nuovo and season_id = v_stagione_attiva
  ) then
    raise exception 'Non puoi spostare un atleta in una squadra già attivata per la stagione in corso: lo spostamento è possibile solo nella finestra di passaggio, prima di confermare la squadra di destinazione';
  end if;

  select user_id into v_user_id from team_members where atleta_id = p_athlete_id and team_id = v_team_vecchio;
  if v_user_id is not null and exists (select 1 from team_members where team_id = p_team_id_nuovo and user_id = v_user_id) then
    raise exception 'Questa persona ha già un accesso sulla squadra di destinazione: sistemalo manualmente prima di spostare l''atleta';
  end if;

  update athletes set team_id = p_team_id_nuovo where id = p_athlete_id;
  update team_members set team_id = p_team_id_nuovo where atleta_id = p_athlete_id and team_id = v_team_vecchio;
end;
$$;
