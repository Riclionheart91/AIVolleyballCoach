-- ============================================================
-- 0001g — Campi aggiuntivi per import completo SportEasy
--
-- Del file Excel reale (43 colonne) importiamo solo i campi con un
-- uso concreto nell'app di coaching: i dati anagrafici/contatto già
-- presenti, PIÙ questi due che mancavano e sono operativamente utili:
-- scadenza del certificato medico (per sapere chi ha la certificazione
-- in scadenza/scaduta) e numero di licenza federale. Le taglie di
-- kit/divisa, i modelli di pantaloncino, i cartellini dirigente/
-- refertista ecc. sono stati lasciati fuori di proposito: non hanno
-- un uso nelle funzionalità dell'app (valutazioni, presenze, scouting)
-- — dimmi se in futuro ne serve comunque qualcuno.
-- ============================================================

alter table athletes add column if not exists numero_licenza text;
alter table athletes add column if not exists scadenza_certificato_medico date;
