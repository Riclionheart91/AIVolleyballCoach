-- 0100 — Avviso del certificato medico: dopo il WhatsApp la notifica sparisce e ricompare in tempo.
--
-- Quando l'allenatore manda il promemoria su WhatsApp, la notifica del certificato si nasconde. Ricompare
-- 7 giorni prima della scadenza (se mancano meno di 7 giorni: alla scadenza; se è già scaduto: dopo 7 giorni).
-- Si ricorda anche per QUALE scadenza è stato mandato l'avviso: se il certificato viene rinnovato (nuova data),
-- l'avviso vecchio non conta più e il ciclo ricomincia.
-- Nessuna nuova regola di accesso: le due colonne si scrivono con la stessa policy della scheda atleta
-- (athletes_write_coach: solo staff tecnico della squadra).

alter table athletes add column if not exists certificato_avviso_scadenza date;
alter table athletes add column if not exists certificato_avviso_fino_a date;

-- ── Rollback ──
-- alter table athletes drop column if exists certificato_avviso_fino_a;
-- alter table athletes drop column if exists certificato_avviso_scadenza;
