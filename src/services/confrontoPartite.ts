import { elencaEventiPerAndamento, rendimentoServizioRicezionePartita } from "@/src/services/matches";
import { elencaStagioniSocieta } from "@/src/services/seasons";
import type { Match, Season } from "@/src/types/database";

/**
 * Confronto di una partita con le precedenti della stessa squadra (stessa stagione).
 * Tutto calcolato lato client dagli eventi che l'app già legge: nessuna query nuova.
 */

/** Evento ridotto a quanto serve per le quattro misure del confronto. */
export interface EventoPerConfronto {
  skill: string;
  esito: string | null;
  qualita: string | null;
}

export type ChiaveMetrica = "ricezione" | "attacco" | "servizio" | "sideout";

export interface MetrichePartita {
  /** % di ricezioni ottime o buone sul totale delle ricezioni. */
  ricezionePositivaPct: number | null;
  /** % di attacchi che fanno punto sul totale degli attacchi. */
  attaccoEfficacePct: number | null;
  /** % di servizi sbagliati sul totale dei servizi. */
  erroriServizioPct: number | null;
  /** % di punti vinti quando riceviamo (dato dalla funzione già in uso nella schermata). */
  sideOutPct: number | null;
  ricezioni: number;
  attacchi: number;
  servizi: number;
}

const arrotonda1 = (v: number) => Math.round(v * 10) / 10;

/** Calcola le misure di una partita. `sideOutPct` arriva da `rendimentoServizioRicezionePartita`. */
export function calcolaMetriche(eventi: EventoPerConfronto[], sideOutPct: number | null | undefined): MetrichePartita {
  let ricezioni = 0, positive = 0, attacchi = 0, attacchiPunto = 0, servizi = 0, serviziErrore = 0;
  for (const e of eventi) {
    if (e.skill === "Ricezione") {
      ricezioni++;
      if (e.qualita === "ottima" || e.qualita === "buona") positive++;
    } else if (e.skill === "Attacco") {
      attacchi++;
      if (e.esito === "punto") attacchiPunto++;
    } else if (e.skill === "Servizio") {
      servizi++;
      if (e.esito === "errore") serviziErrore++;
    }
  }
  const so = sideOutPct == null ? null : Number(sideOutPct);
  return {
    ricezionePositivaPct: ricezioni > 0 ? arrotonda1((positive / ricezioni) * 100) : null,
    attaccoEfficacePct: attacchi > 0 ? arrotonda1((attacchiPunto / attacchi) * 100) : null,
    erroriServizioPct: servizi > 0 ? arrotonda1((serviziErrore / servizi) * 100) : null,
    sideOutPct: so !== null && Number.isFinite(so) ? arrotonda1(so) : null,
    ricezioni, attacchi, servizi,
  };
}

export interface PartitaPrecedente {
  id: string;
  data: string;
  avversario: string;
  metriche: MetrichePartita;
}

export interface RigaConfronto {
  chiave: ChiaveMetrica;
  etichetta: string;
  /** Per gli errori in servizio è meglio un valore più basso. */
  piuAltoMeglio: boolean;
  valore: number | null;
  /** Media delle ultime partite confrontate (solo quelle con il dato). */
  media: number | null;
  /** valore - media, in punti percentuali. */
  differenza: number | null;
  /** true = meglio della media, false = peggio, null = pari o dato mancante. */
  migliora: boolean | null;
}

export interface ProblemaRicorrente {
  chiave: ChiaveMetrica;
  etichetta: string;
  /** In quante delle ultime partite (questa compresa) la misura è peggiore della media. */
  volte: number;
  su: number;
  /** "sotto" per le misure da tenere alte, "sopra" per gli errori. */
  verso: "sotto" | "sopra";
}

export interface ConfrontoPartite {
  /** Le (fino a 3) partite entrate nella media, dalla più recente. */
  partiteConfrontate: { id: string; data: string; avversario: string }[];
  righe: RigaConfronto[];
  problemi: ProblemaRicorrente[];
  /** Frase pronta da mostrare; null se non ci sono abbastanza partite. */
  frase: string | null;
}

const DEFINIZIONI: { chiave: ChiaveMetrica; etichetta: string; piuAltoMeglio: boolean; leggi: (m: MetrichePartita) => number | null }[] = [
  { chiave: "ricezione", etichetta: "Ricezione positiva", piuAltoMeglio: true, leggi: (m) => m.ricezionePositivaPct },
  { chiave: "attacco", etichetta: "Attacco efficace", piuAltoMeglio: true, leggi: (m) => m.attaccoEfficacePct },
  { chiave: "servizio", etichetta: "Errori in servizio", piuAltoMeglio: false, leggi: (m) => m.erroriServizioPct },
  { chiave: "sideout", etichetta: "Side-out", piuAltoMeglio: true, leggi: (m) => m.sideOutPct },
];

/** Differenze sotto questa soglia (punti percentuali) non contano come meglio/peggio. */
export const SOGLIA_DIFFERENZA = 1;
/** Quante partite entrano nella media mostrata. */
export const PARTITE_NELLA_MEDIA = 3;
/** Quante partite precedenti al massimo si leggono (le prime 3 fanno la media, le altre servono a stabilire se un problema si ripete). */
const PARTITE_LETTE_MAX = 6;

const media = (valori: number[]) => (valori.length > 0 ? valori.reduce((a, b) => a + b, 0) / valori.length : null);

/** Mette insieme la riga di confronto per ciascuna misura e individua i problemi che si ripetono. */
export function costruisciConfronto(corrente: MetrichePartita, precedenti: PartitaPrecedente[]): ConfrontoPartite {
  const ultime = precedenti.slice(0, PARTITE_NELLA_MEDIA);
  const righe: RigaConfronto[] = DEFINIZIONI.map((d) => {
    const valore = d.leggi(corrente);
    const m = media(ultime.map((p) => d.leggi(p.metriche)).filter((v): v is number => v !== null));
    const differenza = valore !== null && m !== null ? arrotonda1(valore - m) : null;
    let migliora: boolean | null = null;
    if (differenza !== null && Math.abs(differenza) >= SOGLIA_DIFFERENZA) migliora = d.piuAltoMeglio ? differenza > 0 : differenza < 0;
    return { chiave: d.chiave, etichetta: d.etichetta, piuAltoMeglio: d.piuAltoMeglio, valore, media: m === null ? null : arrotonda1(m), differenza, migliora };
  });

  // Problema che si ripete: la misura è peggiore della media di tutte le partite precedenti lette
  // nella partita aperta E nelle due precedenti più recenti (cioè nelle ultime 3 giocate).
  const problemi: ProblemaRicorrente[] = [];
  if (precedenti.length >= PARTITE_NELLA_MEDIA) {
    for (const d of DEFINIZIONI) {
      const valori = precedenti.map((p) => d.leggi(p.metriche)).filter((v): v is number => v !== null);
      const base = media(valori);
      const attuale = d.leggi(corrente);
      if (base === null || attuale === null) continue;
      const peggio = (v: number) => (d.piuAltoMeglio ? v <= base - SOGLIA_DIFFERENZA : v >= base + SOGLIA_DIFFERENZA);
      if (!peggio(attuale)) continue;
      const serie = [attuale, ...precedenti.slice(0, 2).map((p) => d.leggi(p.metriche))].filter((v): v is number => v !== null);
      if (serie.length < 3) continue;
      const volte = serie.filter(peggio).length;
      if (volte >= 2) problemi.push({ chiave: d.chiave, etichetta: d.etichetta, volte, su: serie.length, verso: d.piuAltoMeglio ? "sotto" : "sopra" });
    }
  }
  problemi.sort((a, b) => b.volte - a.volte);

  let frase: string | null = null;
  if (ultime.length === 0) {
    frase = null;
  } else if (problemi.length > 0) {
    const parti = problemi.map((p) => `${p.etichetta.toLowerCase()} ${p.verso} la media in ${p.volte} partite su ${p.su}`);
    frase = `Da tenere d'occhio: ${parti.join("; ")}.`;
  } else if (precedenti.length < PARTITE_NELLA_MEDIA) {
    frase = `Confronto basato su ${ultime.length === 1 ? "una sola partita" : `${ultime.length} partite`}: troppo poche per dire se un problema si ripete.`;
  } else {
    frase = "Nessun problema che si ripete rispetto alle ultime partite.";
  }

  return {
    partiteConfrontate: ultime.map((p) => ({ id: p.id, data: p.data, avversario: p.avversario })),
    righe, problemi, frase,
  };
}

/** Stagione della società che contiene la data indicata (le stagioni sono di società, non di squadra). */
function stagioneDelGiorno(stagioni: Season[], data: string): Season | null {
  const t = new Date(data).getTime();
  if (!Number.isFinite(t)) return null;
  return stagioni.find((s) => {
    const da = new Date(s.data_apertura).getTime();
    const a = s.data_chiusura ? new Date(s.data_chiusura).getTime() : Infinity;
    return Number.isFinite(da) && t >= da && t <= a + 24 * 3600 * 1000 - 1;
  }) ?? null;
}

/**
 * Sceglie le partite concluse della stessa squadra e stagione che precedono quella aperta,
 * dalla più recente. Se la stagione non è determinabile ripiega sugli ultimi 12 mesi.
 */
export function selezionaPartitePrecedenti(match: Match, partiteSquadra: Match[], stagioni: Season[]): Match[] {
  const stagione = stagioneDelGiorno(stagioni, match.data);
  const dataMatch = new Date(match.data).getTime();
  const inizio = stagione ? new Date(stagione.data_apertura).getTime() : dataMatch - 365 * 24 * 3600 * 1000;
  return partiteSquadra
    .filter((m) => {
      if (m.id === match.id || m.team_id !== match.team_id || m.stato !== "conclusa") return false;
      const t = new Date(m.data).getTime();
      return t < dataMatch && t >= inizio;
    })
    .sort((a, b) => b.data.localeCompare(a.data))
    .slice(0, PARTITE_LETTE_MAX);
}

/**
 * Legge gli eventi delle partite precedenti (servizi già esistenti) e costruisce il confronto.
 * Non lancia mai: se qualcosa non va ritorna null e la sezione resta nascosta.
 * `partiteSquadra` è l'elenco già caricato dalla schermata; `societaId` serve a trovare la stagione.
 */
export async function caricaConfrontoPartite(
  match: Match,
  partiteSquadra: Match[],
  societaId: string | null | undefined,
  metricheCorrenti: MetrichePartita,
): Promise<ConfrontoPartite | null> {
  try {
    let stagioni: Season[] = [];
    if (societaId) stagioni = await elencaStagioniSocieta(societaId).catch(() => [] as Season[]);
    const scelte = selezionaPartitePrecedenti(match, partiteSquadra, stagioni);
    if (scelte.length === 0) return null;
    const precedenti = (await Promise.all(scelte.map(async (m): Promise<PartitaPrecedente | null> => {
      try {
        const [eventi, so] = await Promise.all([
          elencaEventiPerAndamento(m.id),
          rendimentoServizioRicezionePartita(m.id).catch(() => null),
        ]);
        if (eventi.length === 0) return null;
        return { id: m.id, data: m.data, avversario: m.avversario, metriche: calcolaMetriche(eventi, so?.side_out_pct) };
      } catch {
        return null;
      }
    }))).filter((p): p is PartitaPrecedente => p !== null);
    if (precedenti.length === 0) return null;
    return costruisciConfronto(metricheCorrenti, precedenti);
  } catch {
    return null;
  }
}
