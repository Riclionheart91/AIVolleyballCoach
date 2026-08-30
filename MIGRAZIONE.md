# Stato migrazione — AI Volleyball Coach

## Fatto in questo pacchetto

| Fase | Contenuto | Stato |
|---|---|---|
| F0 | Scaffold Expo/Metro/Supabase/GitHub (da template BandFit) | ✅ |
| F1 | Atlete, esercizi, allenamenti, presenze, RPE, valutazioni manuali | ✅ (screen: Atlete, Allenamenti, Valutazioni) |
| F1 (addendum) | Inviti multi-coach: un allenatore invita un'email, chi riceve l'invito entra automaticamente nel team al primo login | ✅ (`0001b_inviti_team.sql`, sezione "Invita allenatore/vice-allenatore" nella tab Atlete) |
| F2 | Stagioni, attivazione, baseline | ✅ (screen: Stagioni) |
| F5 | Layer AI manual-first: proposte di valutazione, Provider Router (Gemini→Groq→OpenRouter), rate limit, badge di stato | ✅ (integrato nello screen Valutazioni, nessuno screen separato — per design, vedi patch V7.1) |
| F1 (revisione 28/08) | Ruoli estesi (presidente sola lettura, atleta con login proprio), privacy dati personali (valutazioni/presenze/RPE viste solo da staff+proprietaria), andamento squadra aggregato per tutti, tab Esercizi, schermata Profilo, stagione-first dopo il login, ruolo in campo a tendina | ✅ (`0001c_ruoli_estesi.sql` + screen aggiornati) |
| F3 | Scouting live: un solo motore dati (`match_events`) al posto di 3 moduli GAS separati, interfaccia a tap (max 2 tocchi), punteggio automatico via trigger, "annulla ultima azione", modalità essenziale, scrittura ottimistica (zero attesa di rete percepita) | ✅ (`0003_f3_scouting.sql`, tab Partite + schermata live `app/partita/[id].tsx`) |

**Non incluso ora:** F4 (match analysis approfondita — per ora c'è solo l'andamento aggregato base in Partite), F6 (infortuni, piani individuali, integrazioni esterne), F7 (QA, migrazione dati storici, CI/CD schema).

## Mappa moduli GAS → Supabase/Expo

| Modulo GAS (V7.1) | Dove va a finire |
|---|---|
| `Auth.gs`, foglio `Utenti` | `team_members` + Supabase Auth (`src/context/AuthContext.tsx`) |
| `Storage.gs` (lock/cache su Sheets) | Non serve più: Postgres gestisce concorrenza e transazioni nativamente |
| Foglio `Atlete` | tabella `athletes` |
| Foglio `Esercizi` | tabella `exercises` |
| `Trainings.gs` + foglio `Allenamenti` | tabella `trainings` + `training_exercises` |
| Foglio `Presenze` | tabella `attendance` |
| `RPE.gs` + foglio `RPE` | tabella `rpe` |
| `Evaluations.gs` + foglio `Valutazioni` | tabella `evaluations` (colonna `origine` sostituisce la distinzione implicita manuale/AI) |
| `EvaluationsAI.gs` + foglio `PropostaValutazioni` | tabella `evaluation_proposals` + RPC `decidi_proposta_valutazione`/`rigetta_proposta_valutazione` |
| `Seasons.gs` (incl. `attivaStagione`, `generaBaselineStagione`) | tabella `seasons` + `season_baselines`, stessa logica come funzioni RPC Postgres |
| `AI.gs` + `RateLimiter.gs` + foglio `AiProviders` | Edge Function `ai-router` + tabelle `ai_providers_config`/`ai_call_log` |
| `Config.gs` (chiavi AI) | Secret dell'Edge Function (`supabase secrets set`), mai in una tabella |
| `ReleaseManager.gs` / `Steps.gs` / `upgrade()` | `supabase/migrations/*.sql` + `supabase db push` (versionamento nativo di Supabase) |
| `Scouting.gs`, `ScoutingAtleta.gs`, `ScoutingAdvanced.gs` | `matches` + `match_sets` + `match_events` (un solo motore, F3 fatto — vedi sopra) |
| `MatchAnalysis.gs` | **F4, non ancora migrato** — oggi c'è solo l'andamento base tra partite (tab Partite); un'analisi più ricca (efficienza per rotazione, distribuzione attacco, ecc.) resta da fare
| `Convocations.gs`, `IndividualPlans.gs`, `Periodization.gs`, `Injuries.gs` | **F6, non ancora migrati** |
| `GoogleAutomations.gs`, `SportEasySync.gs` | **F6, non ancora migrati** (da accorpare in un unico modulo "Integrazioni") |
| `Setup.gs`, `install.gs` | `app/crea-squadra.tsx` + RPC `crea_team_e_diventa_allenatore` |
| `ImportWizard.gs` | Da rifare in F6/F7 come importer verso le nuove tabelle |

## Decisioni prese (28/08/2026)

- **Storico valutazioni**: non importato. Si parte da valutazioni nuove da qui in avanti; le baseline di stagione si genereranno quindi solo a partire dalle prime valutazioni inserite nella nuova app, non da dati storici GAS.
- **Multi-coach**: sì — implementato il sistema di inviti (`0001b_inviti_team.sql`). Un allenatore invita un'email dalla tab Atlete → chi riceve l'invito entra automaticamente nel team al primo login con quell'account Google, senza altre azioni manuali.
- **Esercizi**: sì, da importare da un catalogo esistente. **In attesa del file**: carica in chat l'export CSV/Excel del foglio "Esercizi" del vecchio spreadsheet (Google Sheets → File → Scarica → Valori separati da virgola) e verrà generato uno script SQL di seed con `insert into exercises (...)` pronto da incollare dopo `setup_supabase.sql`, senza reinserimento manuale nell'app.



Questo pacchetto è codice pronto, ma nessun comando è stato lanciato contro servizi reali — serve fare, nell'ordine (dettagli in `README.md`):
1. Creare il progetto Supabase e lanciare `supabase db push`.
2. Configurare Google OAuth (Cloud Console + Supabase).
3. Deployare `ai-router` e impostare i secret delle chiavi AI.
4. `npm install` e test in locale.
5. Push su GitHub + primo deploy su Pages.

## Ruoli e permessi (dopo la revisione del 28/08/2026)

| Ruolo | Scrittura | Lettura dati personali (valutazioni/presenze/RPE) | Andamento squadra aggregato |
|---|---|---|---|
| Allenatore | Tutto | Di tutte le atlete | Sì |
| Vice-allenatore | Tutto, alla pari dell'allenatore | Di tutte le atlete | Sì |
| Presidente | Nessuna (sola lettura ovunque) | Di tutte le atlete | Sì |
| Atleta | Solo i propri contatti (telefono/email/note) | Solo le proprie | Sì |

Applicato sia lato database (RLS — anche un bug nella UI non potrebbe far trapelare dati di una compagna) sia lato interfaccia (i controlli di scrittura non vengono nemmeno mostrati a chi non può usarli).

**Cosa NON è ancora previsto per il ruolo atleta**: non può registrare da sé presenze/RPE/valutazioni (restano compiti dell'allenatore, come nella versione GAS originale) — vede e basta i propri dati storici. Se in futuro vorrete che le atlete si auto-registrino la presenza o l'RPE post-allenamento, è un'estensione naturale della stessa RLS già in campo, da fare quando serve.

**Report per il presidente**: per ora è la stessa vista aggregata "andamento squadra" visibile a tutti (Valutazioni → riquadro in alto, e ora anche Partite), non ancora un vero generatore di report esportabile (PDF/Excel) — quello lo colloco in F6/F7 insieme al resto degli strumenti di reportistica, se vorrete.

## Scouting live (F3) — cosa sapere

- Il vecchio scouting "avanzato" (zone campo, rotazioni complete) non è ancora incluso: qui l'unica assegnazione per evento è l'atleta selezionata nella striscia in alto, che resta impostata finché non la cambi — non c'è ancora una gestione formale delle rotazioni/formazioni. È un ampliamento naturale della stessa tabella `match_events` (basta aggiungere colonne), da fare quando serve davvero.
- La scrittura è "ottimistica" (il tocco si vede subito, la chiamata di rete parte in background) ma non è un vero buffer offline persistente: se il tablet perde la connessione a lungo e viene chiuso/ricaricato prima che la sincronizzazione vada a buon fine, quell'evento si perde. Per uno scouting realmente offline-first (persistenza locale con coda che sopravvive a un riavvio) serve un ulteriore giro di lavoro — dimmi se è prioritario.
- Il punteggio del set è calcolato interamente dal database (trigger), mai da editare a mano: è così che "annulla ultima azione" può essere una semplice cancellazione senza logica di compensazione lato app.

## Prossimi passi consigliati (quando deciderai di procedere)

- **F3 — Scouting live**: nuova migrazione `0003_f3_scouting.sql` con la tabella `match_events` unica (vedi piano di migrazione originale) + schermata a tap, scrittura locale-first con coda di sync.
- **F4 — Match analysis**: query aggregate su `match_events`, nessuna tabella nuova.
- **F6 — Resto moduli + integrazioni**: `0004_f6_resto.sql`.
- **F7 — Migrazione dati storici**: script una tantum di export da Google Sheets (via API) + import nelle tabelle Supabase, da scrivere quando le squadre reali saranno pronte a passare.

Nessuna di queste fasi richiede di toccare F1/F2/F5: lo schema è additivo esattamente come il vecchio `RELEASE_STEPS_`.
