# Roadmap — AI Volleyball Coach

## ✅ Fatto

**F1 — Anagrafica base**: atlete (con scheda dettaglio, archivia/ripristina/elimina), esercizi (con scheda dettaglio), allenamenti (modificabili/eliminabili, data anche futura), presenze, RPE, valutazioni manuali.

**F2 — Stagioni**: creazione, attivazione, baseline, conclusione. Gate obbligatorio dopo il login (se non c'è una stagione attiva, va aperta o consultata in lettura).

**F3 — Scouting live**: un solo motore dati (`match_events`) invece dei tre moduli separati della versione GAS. Interfaccia a tap (max 2 tocchi), punteggio automatico via trigger, "annulla ultima azione", modalità essenziale, atlete riconosciute per numero maglia, scrittura ottimistica.

**F5 — Layer AI manual-first**: Provider Router (Gemini→Groq→OpenRouter) con fallback automatico, proposte di valutazione mai imposte (sempre modificabili prima di registrare), badge di stato, quota giornaliera.

**Ruoli e permessi**: allenatore, vice-allenatore (alla pari), presidente (sola lettura ovunico + andamento aggregato), atleta (solo i propri dati, mai quelli delle compagne), super-amministratore (trasversale a tutte le squadre, attivabile solo via SQL diretto).

**Multi-squadra**: un account può seguire più squadre, selettore con pulsante "+", ultima squadra ricordata.

**Integrazioni**: sync SportEasy (solo eventi calendario, mai anagrafica), import massivo atlete via wizard Excel/CSV con dedup su codice fiscale e revisione differenze.

**Mobile/PWA**: meta tag per l'installazione standalone su iOS/Android, tab bar ottimizzata, pulsanti "+" flottanti al posto dei form fissi, dialog di conferma funzionanti anche su web.

**Impostazioni**: link SportEasy, provider AI per squadra e globali (superuser).

## 🚧 In corso di verifica

- **Bug: al login chiede sempre di ricreare la squadra.** Fix applicato lato database (ricorsione nelle regole di sicurezza) — in attesa di conferma che lo script SQL più recente vada a buon fine e risolva davvero il sintomo.

## 📋 Prossime evolutive (non ancora iniziate)

Elencate in ordine di menzione, non di priorità — dimmi tu come ordinarle quando riprendiamo.

1. **~~Creazione squadra + stagione già aperta~~** — fatto, con un'interpretazione leggermente diversa dalla richiesta originale (una squadra nuova non può avere una stagione): la schermata "apri stagione" ora propone di **attivare** una stagione già creata ma mai attivata (stato "pianificata"), invece di offrire solo "creane una nuova". Segnalare se non era questo il caso a cui pensavi.
2. **Import completo anagrafica da SportEasy**: caricare tutti i campi disponibili in un export Excel di SportEasy (non solo quelli già mappati oggi). *Prima di iniziare, va richiesto il file Excel reale per vedere le colonne disponibili.*
3. **Pianificazione allenamenti**: scelta di argomento/tema, esercizi dal catalogo con durata di ciascuno e durata totale della sessione, pulsante per generare una proposta via AI.
4. **Valutazioni a cadenza mensile con notifica**: invece del flusso ad-hoc attuale, un ciclo mensile con promemoria per valutare ogni atleta.
5. **Scouting avanzato**: gestione di formazione/rotazione (chi sta servendo/ricevendo), azioni limitate a chi può davvero eseguirle in quel momento di gioco.
6. **F4 — Match analysis più ricca**: oggi solo andamento aggregato base (punti/errori per fondamentale tra partite); mancano efficienza per rotazione, distribuzione attacco, ecc.
7. **F6 — resto**: infortuni, piani individuali, periodizzazione.
8. **Estendere il bypass superuser** alle tabelle non ancora coperte (exercises, trainings, attendance, rpe, evaluation_proposals, season_baselines, team_invites, team_integrations, ai_call_log).
9. **F7 — Migrazione dati storici da Google Sheets**, quando le squadre reali saranno pronte a passare.

## Note di processo

- Lo schema del database è **additivo**: ogni nuova fase aggiunge migrazioni, non modifica quelle già applicate — puoi rieseguire `setup_supabase.sql` in sicurezza in qualunque momento.
- Ogni pacchetto include `pubblica_aggiornamento.sh` per portare gli aggiornamenti su GitHub senza dover individuare a mano i file cambiati.
