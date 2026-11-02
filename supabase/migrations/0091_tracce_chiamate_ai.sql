-- 0091 — Tracce delle chiamate AI.
--
-- Prima ai_call_log registrava solo le chiamate riuscite, con squadra, provider e orario.
-- Ora registra anche i fallimenti, quanto ci ha messo la risposta, quale funzione dell'app l'ha chiesta
-- e quanti provider sono stati provati. Del prompt si salva solo la lunghezza: il testo puo' contenere dati
-- delle atlete e non va archiviato.
--
-- La quota giornaliera (20 chiamate per squadra) continua a contare solo le chiamate riuscite,
-- cosi' un provider che non risponde non consuma il limite dell'allenatore.

alter table ai_call_log alter column provider_usato drop not null;

alter table ai_call_log add column if not exists esito text not null default 'ok' check (esito in ('ok', 'errore'));
alter table ai_call_log add column if not exists durata_ms integer;
alter table ai_call_log add column if not exists funzione text;
alter table ai_call_log add column if not exists tentativi integer;
alter table ai_call_log add column if not exists errore text;
alter table ai_call_log add column if not exists prompt_caratteri integer;

create or replace function ai_chiamate_residue_oggi(p_team_id uuid)
returns integer
language sql stable
as $$
  select greatest(0, 20 - count(*)::integer)
  from ai_call_log
  where team_id = p_team_id and esito = 'ok' and creato_il >= date_trunc('day', now());
$$;

-- Riepilogo per provider e funzione: serve a capire chi fallisce, quanto e' lento e quanto viene usato.
create or replace function ai_riepilogo_chiamate(p_team_id uuid, p_giorni integer default 7)
returns table(provider text, funzione text, chiamate bigint, errori bigint, durata_media_ms integer)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if auth.uid() is null then raise exception 'Utente non autenticato'; end if;
  if not (is_team_coach(p_team_id) or is_superuser()) then raise exception 'Permesso negato'; end if;
  return query
    select coalesce(l.provider_usato, '(nessuno)')::text,
           coalesce(l.funzione, '(non indicata)')::text,
           count(*),
           count(*) filter (where l.esito = 'errore'),
           round(avg(l.durata_ms))::integer
    from ai_call_log l
    where l.team_id = p_team_id
      and l.creato_il >= now() - make_interval(days => greatest(1, least(p_giorni, 90)))
    group by 1, 2
    order by 3 desc;
end;
$function$;
