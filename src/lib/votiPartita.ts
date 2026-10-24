/**
 * Voto della giocatrice (0-10) e valutazione per fondamentale, calcolati dagli
 * eventi della partita.
 *
 * Per ogni fondamentale si ricava un indice s tra -1 e +1:
 *  - Ricezione e Difesa (se c'e' la qualita'): (perfette + 0,5 x buone - errori) / azioni
 *  - gli altri (e quando manca la qualita'): (punti - errori) / azioni
 * Con poche azioni l'indice si smorza verso il "sufficiente" (n / (n + 3)).
 * Voto del fondamentale = 6 + 4 x s (0 = tutto errori, 6 = in equilibrio, 10 = tutto punti), tra 0 e 10.
 * Voto generale = media dei voti dei fondamentali pesata sulla radice delle azioni.
 * Sotto le 5 azioni totali non si da' il voto (n.c.).
 */
export const MIN_AZIONI_VOTO = 5;

export interface EventoPerVoto {
  athlete_id: string | null;
  skill: string;
  esito: string | null;
  qualita: string | null;
}

export interface VotoFondamentale {
  fondamentale: string;
  azioni: number;
  punti: number;
  neutri: number;
  errori: number;
  perfette: number;
  buone: number;
  scarse: number;
  /** True se il voto tiene conto della qualita' (ricezione/difesa). */
  conQualita: boolean;
  voto: number;
}

export interface VotoGiocatrice {
  athlete_id: string;
  azioni: number;
  /** null = non classificabile (poche azioni). */
  voto: number | null;
  fondamentali: VotoFondamentale[];
}

const arrotonda = (v: number) => Math.round(v * 10) / 10;
const limita = (v: number) => Math.max(0, Math.min(10, v));

export function votoFondamentale(f: Omit<VotoFondamentale, "voto" | "conQualita">): { voto: number; conQualita: boolean } {
  const conQualita = (f.fondamentale === "Ricezione" || f.fondamentale === "Difesa") && f.perfette + f.buone + f.scarse > 0;
  const grezzo = conQualita
    ? (f.perfette + 0.5 * f.buone - f.errori) / f.azioni
    : (f.punti - f.errori) / f.azioni;
  const indice = grezzo * (f.azioni / (f.azioni + 3));
  return { voto: arrotonda(limita(6 + 4 * indice)), conQualita };
}

const ORDINE = ["Servizio", "Ricezione", "Attacco", "Muro", "Difesa"];

export function calcolaVoti(eventi: EventoPerVoto[]): Record<string, VotoGiocatrice> {
  const perGiocatrice = new Map<string, Map<string, Omit<VotoFondamentale, "voto" | "conQualita">>>();
  for (const e of eventi) {
    if (!e.athlete_id || e.skill === "Punto_nostro" || e.skill === "Punto_avversario") continue;
    const m = perGiocatrice.get(e.athlete_id) ?? new Map();
    perGiocatrice.set(e.athlete_id, m);
    const f = m.get(e.skill) ?? { fondamentale: e.skill, azioni: 0, punti: 0, neutri: 0, errori: 0, perfette: 0, buone: 0, scarse: 0 };
    m.set(e.skill, f);
    f.azioni++;
    if (e.esito === "punto") f.punti++;
    else if (e.esito === "errore") f.errori++;
    else {
      f.neutri++;
      if (e.qualita === "ottima") f.perfette++;
      else if (e.qualita === "buona") f.buone++;
      else if (e.qualita === "scarsa") f.scarse++;
    }
  }
  const out: Record<string, VotoGiocatrice> = {};
  for (const [athleteId, m] of perGiocatrice) {
    const fondamentali: VotoFondamentale[] = [...m.values()]
      .map((f) => ({ ...f, ...votoFondamentale(f) }))
      .sort((a, b) => (ORDINE.indexOf(a.fondamentale) + 99) % 99 - (ORDINE.indexOf(b.fondamentale) + 99) % 99);
    const azioni = fondamentali.reduce((s, f) => s + f.azioni, 0);
    let voto: number | null = null;
    if (azioni >= MIN_AZIONI_VOTO) {
      const pesi = fondamentali.map((f) => Math.sqrt(f.azioni));
      const somma = pesi.reduce((s, p) => s + p, 0);
      voto = arrotonda(fondamentali.reduce((s, f, i) => s + f.voto * pesi[i], 0) / somma);
    }
    out[athleteId] = { athlete_id: athleteId, azioni, voto, fondamentali };
  }
  return out;
}

export function coloreVoto(voto: number | null): "muted" | "success" | "brand" | "warning" | "error" {
  if (voto === null) return "muted";
  if (voto >= 7.5) return "success";
  if (voto >= 6) return "brand";
  if (voto >= 5) return "warning";
  return "error";
}
