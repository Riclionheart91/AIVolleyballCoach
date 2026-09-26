-- ============================================================
-- 0061 — Pulizia: assegna_allenatore_squadra(uuid, text) era stata
-- superata da assegna_collaboratore_squadra (che gestisce sia
-- allenatore sia vice-allenatore) e non era più chiamata da nessuna
-- schermata. Rimossa insieme al suo wrapper lato client.
-- ============================================================

drop function if exists assegna_allenatore_squadra(uuid, text);
