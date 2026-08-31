-- ============================================================
-- 0001e — Codice fiscale atlete (per deduplica import Excel)
--
-- Chiave di dedup nel wizard di import: se presente, il codice fiscale
-- (univoco per persona) evita di duplicare un'atleta già censita anche
-- se nome/cognome sono scritti in modo leggermente diverso nel file
-- caricato; il fallback (nome+cognome normalizzati) resta gestito lato
-- client, non richiede struttura dati aggiuntiva qui.
-- ============================================================

alter table athletes add column if not exists codice_fiscale text;

-- Case-insensitive: "RSSMRA80A01H501U" e "rssmra80a01h501u" devono
-- essere riconosciuti come la stessa persona.
create unique index if not exists idx_athletes_codice_fiscale
  on athletes (team_id, upper(codice_fiscale)) where codice_fiscale is not null;
