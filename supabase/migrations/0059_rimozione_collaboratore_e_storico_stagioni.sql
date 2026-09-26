-- ============================================================
-- 0059 — Punti aggiuntivi di gestione squadre chiesti dal presidente:
--   1) rimuovere un allenatore/vice senza doverne assegnare subito un
--      altro (rimuovi_collaboratore_squadra);
--   2) corretto assegna_collaboratore_squadra, che finora non
--      rimuoveva il precedente titolare del ruolo: "cambia allenatore"
--      poteva finire per aggiungerne un secondo invece di sostituirlo
--      (bug pre-esistente, corretto qui in un colpo solo);
--   3) storico delle stagioni di società per una singola squadra,
--      con indicazione se in ciascuna la squadra è stata attivata.
-- ============================================================

create or replace function assegna_collaboratore_squadra(p_team_id uuid, p_email text, p_ruolo text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_societa_id uuid;
  v_email_normalizzata text;
  v_invito_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if p_ruolo not in ('allenatore', 'vice_allenatore') then raise exception 'Profilo non valido'; end if;
  select societa_id into v_societa_id from teams where id = p_team_id;
  if v_societa_id is null or not is_societa_presidente(v_societa_id) then
    raise exception 'Solo il presidente della società può assegnare allenatore e vice';
  end if;

  v_email_normalizzata := lower(trim(p_email));
  if v_email_normalizzata = '' or v_email_normalizzata is null then raise exception 'Email non valida'; end if;

  -- Un solo allenatore e un solo vice per squadra alla volta: chi
  -- occupava già questo ruolo (membro attivo o invito ancora in
  -- sospeso) viene rimosso prima di invitare la persona nuova.
  delete from team_members where team_id = p_team_id and ruolo = p_ruolo;
  delete from team_invites where team_id = p_team_id and ruolo = p_ruolo and usato_il is null;

  insert into team_invites (team_id, email, ruolo, creato_da)
  values (p_team_id, v_email_normalizzata, p_ruolo, auth.uid())
  returning id into v_invito_id;

  return v_invito_id;
end;
$$;

create or replace function rimuovi_collaboratore_squadra(p_team_id uuid, p_ruolo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if p_ruolo not in ('allenatore', 'vice_allenatore') then raise exception 'Profilo non valido'; end if;
  if not is_team_presidente(p_team_id) then
    raise exception 'Solo il presidente della società può rimuovere allenatore e vice';
  end if;

  delete from team_members where team_id = p_team_id and ruolo = p_ruolo;
  delete from team_invites where team_id = p_team_id and ruolo = p_ruolo and usato_il is null;
end;
$$;

create or replace function storico_stagioni_squadra(p_team_id uuid)
returns table(
  season_id uuid,
  nome text,
  stato text,
  data_apertura date,
  data_chiusura date,
  squadra_attivata boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_societa_id uuid;
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not is_team_presidente(p_team_id) then raise exception 'Permesso negato'; end if;

  select societa_id into v_societa_id from teams where id = p_team_id;
  if v_societa_id is null then raise exception 'Squadra non trovata'; end if;

  return query
  select s.id, s.nome, s.stato, s.data_apertura, s.data_chiusura,
    exists(select 1 from team_stagioni_attivazioni tsa where tsa.team_id = p_team_id and tsa.season_id = s.id)
  from seasons s
  where s.societa_id = v_societa_id
  order by s.data_apertura desc nulls last;
end;
$$;
