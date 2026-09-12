# Regole di gioco — riferimento per l'app

Estratte dal regolamento FIVB 2025-2028 (recepito da FIPAV, con le varianti FIPAV segnalate). Riformulate qui in forma sintetica per uso tecnico, non è il testo ufficiale — per quello vale sempre il regolamento federale.

## Usate ora nell'implementazione

**Formazione e posizioni (Art. 7.3-7.4)**
- Sempre 6 giocatrici in campo. Posizioni numerate 1-6: avanti = 4 (sinistra), 3 (centro), 2 (destra); difensori = 5 (sinistra), 6 (centro), 1 (destra, è anche la zona di servizio).
- La formazione iniziale (chi occupa quale posizione) va dichiarata prima di ogni set e determina l'ordine di rotazione per tutto il set.

**Rotazione (Art. 7.6)**
- Quando la squadra in ricezione vince lo scambio, conquista il servizio e ruota di una posizione in **senso orario**: 2→1 (va a servire), 1→6, 6→5, 5→4, 4→3, 3→2.
- Se invece vince la squadra al servizio, nessuna rotazione: continua a servire la stessa giocatrice.

**Punteggio (Art. 6)**
- Set vinto a 25 punti con 2 di scarto (continua oltre se 24-24: 26-24, 27-25...). Gara vinta al meglio di 5 set. Il 5° set (decisivo) si gioca a 15 punti con 2 di scarto, con cambio campo all'8° punto della squadra in vantaggio.

**Sostituzioni (Art. 15.1, 15.6)**
- Massimo 6 sostituzioni per set per squadra (FIPAV Supercoppa/Coppa Italia serie A: resta comunque 6, cambia solo il numero di time-out).
- Una titolare può uscire una sola volta per set e rientrare una sola volta per set, sempre nella stessa posizione di formazione. Una riserva puó entrare una sola volta per set ed essere sostituita solo dalla stessa titolare che aveva rimpiazzato.

**Libero (Art. 19)**
- Fino a 2 Libero per squadra; FIPAV: obbligatori 2 se la squadra ha più di 12 giocatrici a referto.
- I rimpiazzi del Libero **non contano** come sostituzioni normali e sono illimitati (basta un'azione completata tra un rimpiazzo e l'altro).
- Il Libero sostituisce solo giocatrici in seconda linea (difensori), non può servire, murare, né attaccare se la palla è interamente sopra il nastro della rete quando è in zona d'attacco.

**Squadra e distinta gara (Art. 4.1, FIPAV)**
- Rosa gara: fino a 14 giocatrici a referto (inclusi i 2 Libero) nei campionati FIPAV. Numerazione maglia: 1-99 in FIPAV (1-20 nella regola FIVB generale).
- Una volta consegnata la distinta firmata (CAMP3 in FIPAV), la composizione non è più modificabile per quella gara.

## Non ancora implementate (utili per evolutive future)

- **Time-out**: 2 per set (1 solo nelle finali di Supercoppa/Coppa Italia serie A FIPAV), durata 30 secondi.
- **Cambio campo**: dopo ogni set (tranne l'ultimo, dove si cambia all'8° punto del vantaggio senza fermare il gioco).
- **Fallo di rotazione/posizione**: se una giocatrice non è nella posizione corretta al momento del servizio, punto e servizio all'avversario — utile per un futuro validatore automatico della formazione.
- **Sostituzione eccezionale**: per infortunio/espulsione quando le sostituzioni normali non bastano più, non conta come sostituzione regolare.
- **Ridesignazione del Libero**: se l'unico Libero non può più giocare, l'allenatore può designarne un altro tra le giocatrici non in campo.
- **Cartellini e sanzioni disciplinari** (giallo/rosso/espulsione/squalifica): utile solo se in futuro si vuole tracciare la disciplina, non necessario per lo scouting tecnico.
- **Ruoli arbitrali/segnapunti**: fuori scope per un'app lato squadra.

## Multi-federazione (FIPAV / PGS / CSI)

Le federazioni minori (PGS, CSI) tipicamente ricalcano le regole FIVB/FIPAV con variazioni locali su: numero massimo di sostituzioni, punteggio (alcuni tornei giovanili usano set più corti), numero di Libero ammessi, regole età/categoria. Non avendo il regolamento ufficiale di PGS/CSI, l'app modella questi parametri come **configurabili per campionato** (non hardcoded), così un domani basta creare una nuova voce "campionato" con i suoi numeri invece di modificare il codice.

## Cosa implementa oggi l'app (0010_regolamento_formazione.sql)

- Rotazione oraria automatica (trigger sul database, mai calcolata a mano).
- Annulla ultima azione che ripristina anche rotazione/turno di servizio.
- Campionati configurabili per squadra (federazione, punti/set, max Libero, max sostituzioni, numerazione maglia, min/max distinta) — una squadra può averne più di uno attivo insieme.
- Convocati per singola gara (possono essere meno dell'intera rosa), con distinta validata contro i limiti del campionato scelto.
- Formazione iniziale su campo 9x9, posizione per posizione.
- Avvio esplicito della partita (nessun avvio automatico): registra_evento rifiuta di funzionare finché non viene premuto il pulsante di avvio.
- Cambio giocatore di base (sposta la posizione dall'uscente all'entrante) — **senza ancora** l'enforcement completo dei vincoli di regolamento (una titolare rientra una sola volta, una riserva è sostituita solo dalla stessa titolare): implementabile in un secondo passaggio se serve davvero nell'uso reale.
