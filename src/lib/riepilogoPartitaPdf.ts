import { Platform, Share } from "react-native";

/**
 * Riepilogo di fine partita in un vero PDF di una pagina A4, pronto da inviare in chat.
 * Il progetto non ha librerie PDF e non se ne possono aggiungere: il file e' scritto a mano
 * (testo in Helvetica standard, rettangoli e linee), quindi funziona identico su browser e
 * senza dipendenze. I testi con lettere accentate italiane sono codificati in WinAnsi.
 */

/* ---------------------------------------------------------------- dati */

export interface RiepilogoStatistica {
  etichetta: string;
  valore: string;
  dettaglio?: string;
  /** 0-100: se presente si disegna una barra sotto il valore. */
  percentuale?: number | null;
}

export interface RiepilogoConfrontoRiga {
  etichetta: string;
  valore: string;
  media: string;
  /** Differenza gia' formattata (es. "+4,5"), vuota se non disponibile. */
  differenza: string;
  /** true = meglio della media, false = peggio, null = pari o senza dato. */
  migliora: boolean | null;
}

export interface RiepilogoMigliore {
  fondamentale: string;
  nome: string;
  dettaglio: string;
}

export interface RiepilogoAndamentoSet {
  numero: number;
  noi: number;
  avv: number;
  /** Differenza punti (noi - loro) dopo ogni punto. */
  differenze: number[];
  serieNoi: number;
  serieAvv: number;
}

export interface RiepilogoPartita {
  squadra: string;
  avversario: string;
  /** Data gia' formattata, es. "04/11/2026". */
  data: string;
  luogo: string | null;
  stato: string;
  setVintiNoi: number;
  setVintiLoro: number;
  setGiocati: { numero: number; noi: number; avv: number }[];
  statistiche: RiepilogoStatistica[];
  confronto: { titolo: string; righe: RiepilogoConfrontoRiga[]; frase: string | null } | null;
  migliori: RiepilogoMigliore[];
  migliorInCampo: { nome: string; voto: string } | null;
  andamento: RiepilogoAndamentoSet[];
}

/* ---------------------------------------------------------------- font */

// Larghezze Helvetica (1/1000 em) per i caratteri ASCII 32..126.
const LARGHEZZE_REG = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
// Helvetica-Bold: differisce solo per alcune lettere (e punteggiatura).
const LARGHEZZE_BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

function letteraBase(c: string): string {
  const base = c.normalize("NFD").charAt(0);
  return base && base.charCodeAt(0) < 128 ? base : "?";
}

function larghezza(testo: string, size: number, grassetto = false): number {
  const tab = grassetto ? LARGHEZZE_BOLD : LARGHEZZE_REG;
  let somma = 0;
  for (const ch of testo) {
    let c = ch;
    if (c.charCodeAt(0) < 32 || c.charCodeAt(0) > 126) c = letteraBase(c);
    const code = c.charCodeAt(0);
    somma += code >= 32 && code <= 126 ? tab[code - 32] : 556;
  }
  return (somma / 1000) * size;
}

const SPECIALI: Record<string, number> = {
  "–": 0x96, "—": 0x97, "’": 0x92, "‘": 0x91, "“": 0x93, "”": 0x94, "•": 0x95, "…": 0x85, "−": 0x2d,
};

/** Stringa JS -> stringa di byte WinAnsi, con \ ( ) protetti, pronta da mettere tra parentesi. */
function codifica(testo: string): string {
  let out = "";
  for (const ch of testo) {
    let code = ch.charCodeAt(0);
    if (SPECIALI[ch] !== undefined) code = SPECIALI[ch];
    else if (!((code >= 32 && code <= 126) || (code >= 160 && code <= 255))) code = letteraBase(ch).charCodeAt(0);
    const c = String.fromCharCode(code);
    out += c === "\\" || c === "(" || c === ")" ? "\\" + c : c;
  }
  return out;
}

/** Accorcia con "..." finche' il testo sta nella larghezza data. */
function adatta(testo: string, size: number, maxW: number, grassetto = false): string {
  if (larghezza(testo, size, grassetto) <= maxW) return testo;
  let t = testo;
  while (t.length > 1 && larghezza(t + "...", size, grassetto) > maxW) t = t.slice(0, -1);
  return t.trimEnd() + "...";
}

/** Va a capo per parole entro maxW; ritorna al massimo `maxRighe` righe (l'ultima con "..." se tagliata). */
function vaACapo(testo: string, size: number, maxW: number, maxRighe: number, grassetto = false): string[] {
  const parole = testo.split(/\s+/).filter(Boolean);
  const righe: string[] = [];
  let corrente = "";
  for (const p of parole) {
    const prova = corrente ? corrente + " " + p : p;
    if (larghezza(prova, size, grassetto) <= maxW || !corrente) corrente = prova;
    else { righe.push(corrente); corrente = p; }
  }
  if (corrente) righe.push(corrente);
  if (righe.length > maxRighe) {
    const tagliate = righe.slice(0, maxRighe);
    tagliate[maxRighe - 1] = adatta(tagliate[maxRighe - 1] + " ...", size, maxW, grassetto);
    return tagliate;
  }
  return righe;
}

/* ---------------------------------------------------------------- disegno */

type Rgb = [number, number, number];
const hex = (h: string): Rgb => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const COL = {
  testo: hex("#111827"),
  secondario: hex("#374151"),
  tenue: hex("#6B7280"),
  scheda: hex("#F3F4F6"),
  traccia: hex("#E5E7EB"),
  marchio: hex("#F26B00"),
  azzurro: hex("#0284C7"),
  verde: hex("#15803D"),
  rosso: hex("#DC2626"),
  bianco: hex("#FFFFFF"),
};

const PAG_W = 595.28;
const PAG_H = 841.89;
const MARGINE = 36;
const CONTENUTO_W = PAG_W - 2 * MARGINE;

const n = (v: number) => (Math.round(v * 100) / 100).toString();
const colore = (c: Rgb, tratto = false) => `${n(c[0])} ${n(c[1])} ${n(c[2])} ${tratto ? "RG" : "rg"}`;

/** Coordinate "dall'alto" (come su carta): il PDF le vuole dal basso, la conversione e' qui. */
class Pagina {
  readonly op: string[] = [];
  private y(top: number) { return PAG_H - top; }

  rettangolo(x: number, top: number, w: number, h: number, fill: Rgb) {
    this.op.push(`${colore(fill)} ${n(x)} ${n(this.y(top + h))} ${n(w)} ${n(h)} re f`);
  }

  rettangoloArrotondato(x: number, top: number, w: number, h: number, r: number, fill: Rgb) {
    const k = 0.5523 * r;
    const x0 = x, x1 = x + w, y0 = this.y(top + h), y1 = this.y(top);
    this.op.push(
      `${colore(fill)} ${n(x0 + r)} ${n(y0)} m ${n(x1 - r)} ${n(y0)} l ` +
      `${n(x1 - r + k)} ${n(y0)} ${n(x1)} ${n(y0 + r - k)} ${n(x1)} ${n(y0 + r)} c ${n(x1)} ${n(y1 - r)} l ` +
      `${n(x1)} ${n(y1 - r + k)} ${n(x1 - r + k)} ${n(y1)} ${n(x1 - r)} ${n(y1)} c ${n(x0 + r)} ${n(y1)} l ` +
      `${n(x0 + r - k)} ${n(y1)} ${n(x0)} ${n(y1 - r + k)} ${n(x0)} ${n(y1 - r)} c ${n(x0)} ${n(y0 + r)} l ` +
      `${n(x0)} ${n(y0 + r - k)} ${n(x0 + r - k)} ${n(y0)} ${n(x0 + r)} ${n(y0)} c f`,
    );
  }

  linea(x1: number, top1: number, x2: number, top2: number, c: Rgb, spessore = 0.75) {
    this.op.push(`${colore(c, true)} ${n(spessore)} w ${n(x1)} ${n(this.y(top1))} m ${n(x2)} ${n(this.y(top2))} l S`);
  }

  polilinea(punti: [number, number][], c: Rgb, spessore = 1.2) {
    if (punti.length < 2) return;
    const [p0, ...resto] = punti;
    this.op.push(
      `${colore(c, true)} ${n(spessore)} w 1 j 1 J ${n(p0[0])} ${n(this.y(p0[1]))} m ` +
      resto.map((p) => `${n(p[0])} ${n(this.y(p[1]))} l`).join(" ") + " S",
    );
  }

  triangolo(x: number, top: number, lato: number, su: boolean, fill: Rgb) {
    const h = lato * 0.9;
    const yb = this.y(top + h), yt = this.y(top);
    const pts = su
      ? [[x, yb], [x + lato, yb], [x + lato / 2, yt]]
      : [[x, yt], [x + lato, yt], [x + lato / 2, yb]];
    this.op.push(`${colore(fill)} ${n(pts[0][0])} ${n(pts[0][1])} m ${n(pts[1][0])} ${n(pts[1][1])} l ${n(pts[2][0])} ${n(pts[2][1])} l f`);
  }

  /** `baseline` = distanza dall'alto della pagina della linea su cui poggia il testo. */
  testo(s: string, x: number, baseline: number, size: number, c: Rgb, opzioni: { grassetto?: boolean; allinea?: "sx" | "dx" | "centro"; maxW?: number } = {}) {
    let t = s;
    const g = !!opzioni.grassetto;
    if (opzioni.maxW) t = adatta(t, size, opzioni.maxW, g);
    if (!t) return;
    let px = x;
    const w = larghezza(t, size, g);
    if (opzioni.allinea === "dx") px = x - w;
    else if (opzioni.allinea === "centro") px = x - w / 2;
    this.op.push(`BT ${colore(c)} /${g ? "F2" : "F1"} ${n(size)} Tf ${n(px)} ${n(this.y(baseline))} Td (${codifica(t)}) Tj ET`);
  }
}

/* ---------------------------------------------------------------- impaginazione */

function titoloSezione(p: Pagina, titolo: string, top: number): number {
  p.testo(titolo.toUpperCase(), MARGINE, top + 9, 8.5, COL.marchio, { grassetto: true });
  p.linea(MARGINE, top + 13, MARGINE + CONTENUTO_W, top + 13, COL.traccia, 0.6);
  return top + 13 + 8;
}

function disegnaIntestazione(p: Pagina, r: RiepilogoPartita, top: number): number {
  p.testo("RIEPILOGO PARTITA", MARGINE, top + 8, 8, COL.marchio, { grassetto: true });
  p.testo(`${r.squadra} vs ${r.avversario}`, MARGINE, top + 31, 20, COL.testo, { grassetto: true, maxW: CONTENUTO_W });
  const sotto = [r.data, r.luogo, r.stato].filter((x): x is string => !!x).join("  ·  ");
  p.testo(sotto, MARGINE, top + 46, 9.5, COL.tenue, { maxW: CONTENUTO_W });
  return top + 58;
}

function disegnaPunteggio(p: Pagina, r: RiepilogoPartita, top: number): number {
  const h = 84;
  p.rettangoloArrotondato(MARGINE, top, CONTENUTO_W, h, 12, COL.scheda);
  const cx = MARGINE + CONTENUTO_W / 2;
  const vintaNoi = r.setVintiNoi > r.setVintiLoro;
  const vintaLoro = r.setVintiLoro > r.setVintiNoi;
  const colRis = vintaNoi ? COL.verde : vintaLoro ? COL.rosso : COL.testo;
  p.testo(`${r.setVintiNoi} - ${r.setVintiLoro}`, cx, top + 46, 34, colRis, { grassetto: true, allinea: "centro" });
  const latoW = CONTENUTO_W / 2 - 80;
  p.testo(r.squadra, cx - 62, top + 38, 11.5, COL.testo, { grassetto: true, allinea: "dx", maxW: latoW });
  p.testo(r.avversario, cx + 62, top + 38, 11.5, COL.testo, { grassetto: true, maxW: latoW });
  p.testo(vintaNoi ? "VITTORIA" : vintaLoro ? "SCONFITTA" : "", cx - 62, top + 52, 8, colRis, { grassetto: true, allinea: "dx" });
  const parziali = r.setGiocati.map((s) => `${s.noi}-${s.avv}`).join("   ·   ");
  if (parziali) p.testo(parziali, cx, top + 71, 10, COL.secondario, { allinea: "centro", maxW: CONTENUTO_W - 24 });
  return top + h;
}

function disegnaStatistiche(p: Pagina, voci: RiepilogoStatistica[], top: number): number {
  let y = titoloSezione(p, "Statistiche principali", top);
  const colonne = 3, gap = 10, h = 54;
  const w = (CONTENUTO_W - gap * (colonne - 1)) / colonne;
  voci.slice(0, 6).forEach((v, i) => {
    const x = MARGINE + (i % colonne) * (w + gap);
    const t = y + Math.floor(i / colonne) * (h + gap);
    p.rettangoloArrotondato(x, t, w, h, 9, COL.scheda);
    p.testo(v.etichetta.toUpperCase(), x + 10, t + 14, 7, COL.tenue, { grassetto: true, maxW: w - 20 });
    p.testo(v.valore, x + 10, t + 36, 20, COL.testo, { grassetto: true, maxW: w - 20 });
    if (v.dettaglio) p.testo(v.dettaglio, x + w - 10, t + 36, 7.5, COL.tenue, { allinea: "dx", maxW: w * 0.45 });
    if (v.percentuale != null) {
      const bw = w - 20;
      p.rettangoloArrotondato(x + 10, t + 44, bw, 4, 2, COL.traccia);
      const riempi = Math.max(0, Math.min(100, v.percentuale)) / 100 * bw;
      if (riempi >= 3) p.rettangoloArrotondato(x + 10, t + 44, riempi, 4, 2, COL.marchio);
    }
  });
  const righe = Math.ceil(Math.min(voci.length, 6) / colonne);
  return y + righe * h + (righe - 1) * gap;
}

function disegnaConfronto(p: Pagina, c: NonNullable<RiepilogoPartita["confronto"]>, top: number): number {
  let y = titoloSezione(p, c.titolo, top);
  const colValore = MARGINE + CONTENUTO_W - 190;
  const colMedia = MARGINE + CONTENUTO_W - 110;
  const colDiff = MARGINE + CONTENUTO_W - 10;
  p.testo("Questa partita", colValore, y + 7, 7, COL.tenue, { grassetto: true, allinea: "dx" });
  p.testo("Media ultime", colMedia, y + 7, 7, COL.tenue, { grassetto: true, allinea: "dx" });
  p.testo("Differenza", colDiff, y + 7, 7, COL.tenue, { grassetto: true, allinea: "dx" });
  y += 12;
  for (const riga of c.righe) {
    p.testo(riga.etichetta, MARGINE, y + 12, 10, COL.testo, { maxW: 200 });
    p.testo(riga.valore, colValore, y + 12, 10, COL.testo, { grassetto: true, allinea: "dx" });
    p.testo(riga.media, colMedia, y + 12, 10, COL.secondario, { allinea: "dx" });
    const col = riga.migliora === null ? COL.tenue : riga.migliora ? COL.verde : COL.rosso;
    if (riga.differenza) {
      p.testo(riga.differenza, colDiff, y + 12, 10, col, { grassetto: true, allinea: "dx" });
      if (riga.migliora !== null) {
        const wDiff = larghezza(riga.differenza, 10, true);
        // La freccia indica il verso del dato (su = aumentato); il colore dice se e' un bene.
        const su = riga.differenza.trim().startsWith("+");
        p.triangolo(colDiff - wDiff - 12, y + 4.5, 8, su, col);
      }
    } else {
      p.testo("—", colDiff, y + 12, 10, COL.tenue, { allinea: "dx" });
    }
    p.linea(MARGINE, y + 17, MARGINE + CONTENUTO_W, y + 17, COL.traccia, 0.4);
    y += 18;
  }
  if (c.frase) {
    const righe = vaACapo(c.frase, 9, CONTENUTO_W, 2, true);
    righe.forEach((riga, i) => p.testo(riga, MARGINE, y + 11 + i * 11.5, 9, c.frase && /tenere d'occhio/.test(c.frase) ? COL.rosso : COL.secondario, { grassetto: true }));
    y += 4 + righe.length * 11.5;
  }
  return y;
}

function disegnaMigliori(p: Pagina, r: RiepilogoPartita, top: number): number {
  let y = titoloSezione(p, "Migliori in campo", top);
  if (r.migliorInCampo) {
    p.testo(`MVP  ${r.migliorInCampo.nome}`, MARGINE, y + 11, 11, COL.testo, { grassetto: true, maxW: CONTENUTO_W - 60 });
    p.testo(r.migliorInCampo.voto, MARGINE + CONTENUTO_W, y + 11, 11, COL.marchio, { grassetto: true, allinea: "dx" });
    y += 18;
  }
  if (r.migliori.length === 0) {
    p.testo("Non ci sono abbastanza azioni per indicare i migliori per fondamentale.", MARGINE, y + 10, 9, COL.tenue);
    return y + 16;
  }
  for (const m of r.migliori.slice(0, 5)) {
    p.testo(m.fondamentale, MARGINE, y + 10, 9.5, COL.tenue, { grassetto: true });
    p.testo(m.nome, MARGINE + 70, y + 10, 10, COL.testo, { grassetto: true, maxW: 190 });
    p.testo(m.dettaglio, MARGINE + CONTENUTO_W, y + 10, 9, COL.secondario, { allinea: "dx", maxW: CONTENUTO_W - 270 });
    y += 15;
  }
  return y;
}

function disegnaAndamento(p: Pagina, sets: RiepilogoAndamentoSet[], top: number): number {
  let y = titoloSezione(p, "Andamento dei set", top);
  const visibili = sets.slice(0, 5);
  if (visibili.length === 0) {
    p.testo("Andamento punto a punto non disponibile.", MARGINE, y + 10, 9, COL.tenue);
    return y + 16;
  }
  const gap = 10;
  const w = (CONTENUTO_W - gap * (visibili.length - 1)) / visibili.length;
  const hGrafico = 46;
  visibili.forEach((s, i) => {
    const x = MARGINE + i * (w + gap);
    p.testo(`Set ${s.numero}`, x, y + 8, 8.5, COL.testo, { grassetto: true });
    p.testo(`${s.noi}-${s.avv}`, x + w, y + 8, 8.5, s.noi > s.avv ? COL.verde : s.noi < s.avv ? COL.rosso : COL.secondario, { grassetto: true, allinea: "dx" });
    const gt = y + 13;
    p.rettangoloArrotondato(x, gt, w, hGrafico, 6, COL.scheda);
    const centro = gt + hGrafico / 2;
    p.linea(x + 4, centro, x + w - 4, centro, COL.traccia, 0.6);
    const diff = s.differenze;
    if (diff.length >= 2) {
      const massimo = Math.max(3, ...diff.map((d) => Math.abs(d)));
      const px = (k: number) => x + 5 + (k / (diff.length - 1)) * (w - 10);
      const py = (d: number) => centro - (d / massimo) * (hGrafico / 2 - 5);
      p.polilinea(diff.map((d, k) => [px(k), py(d)] as [number, number]), COL.marchio, 1.1);
    }
    p.testo(`Serie max  noi ${s.serieNoi} · loro ${s.serieAvv}`, x, gt + hGrafico + 10, 7.5, COL.tenue, { maxW: w });
  });
  p.testo("Sopra la linea = in vantaggio noi, sotto = in vantaggio loro.", MARGINE, y + 13 + hGrafico + 22, 7, COL.tenue);
  return y + 13 + hGrafico + 26;
}

/* ---------------------------------------------------------------- file PDF */

/** Costruisce il PDF (una pagina A4) e lo restituisce come byte. */
export function costruisciPdfRiepilogo(r: RiepilogoPartita): Uint8Array {
  const p = new Pagina();
  let y = MARGINE;
  y = disegnaIntestazione(p, r, y) + 8;
  y = disegnaPunteggio(p, r, y) + 16;
  if (r.statistiche.length > 0) y = disegnaStatistiche(p, r.statistiche, y) + 16;
  if (r.confronto) y = disegnaConfronto(p, r.confronto, y) + 14;
  y = disegnaMigliori(p, r, y) + 16;
  y = disegnaAndamento(p, r.andamento, y);
  const piede = `Generato con AIVolleyballCoach il ${new Date().toLocaleDateString("it-IT")}`;
  p.testo(piede, MARGINE, PAG_H - 22, 7.5, COL.tenue);
  p.linea(MARGINE, PAG_H - 30, MARGINE + CONTENUTO_W, PAG_H - 30, COL.traccia, 0.5);

  const contenuto = p.op.join("\n");
  const titolo = codifica(`Riepilogo ${r.squadra} vs ${r.avversario}`);
  const oggetti: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PAG_W)} ${n(PAG_H)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${contenuto.length} >>\nstream\n${contenuto}\nendstream`,
    `<< /Title (${titolo}) /Producer (AIVolleyballCoach) >>`,
  ];
  let out = "%PDF-1.4\n";
  const offset: number[] = [];
  oggetti.forEach((corpo, i) => {
    offset.push(out.length);
    out += `${i + 1} 0 obj\n${corpo}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${oggetti.length + 1}\n0000000000 65535 f \n`;
  for (const o of offset) out += `${String(o).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${oggetti.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  const byte = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) byte[i] = out.charCodeAt(i) & 0xff;
  return byte;
}

/* ---------------------------------------------------------------- testo, scarica, condividi */

/** Riepilogo in sola scrittura, per chi non puo' ricevere il file (o come testo di accompagnamento). */
export function testoRiepilogo(r: RiepilogoPartita): string {
  const righe: string[] = [];
  righe.push(`${r.squadra} vs ${r.avversario} - ${r.data}`);
  righe.push(`Risultato: ${r.setVintiNoi}-${r.setVintiLoro}${r.setGiocati.length > 0 ? ` (${r.setGiocati.map((s) => `${s.noi}-${s.avv}`).join(", ")})` : ""}`);
  for (const s of r.statistiche) righe.push(`${s.etichetta}: ${s.valore}${s.dettaglio ? ` (${s.dettaglio})` : ""}`);
  if (r.confronto?.frase) righe.push(r.confronto.frase);
  if (r.migliorInCampo) righe.push(`Migliore in campo: ${r.migliorInCampo.nome} (${r.migliorInCampo.voto})`);
  for (const m of r.migliori) righe.push(`${m.fondamentale}: ${m.nome} - ${m.dettaglio}`);
  return righe.join("\n");
}

export function nomeFileRiepilogo(r: RiepilogoPartita): string {
  const base = `${r.squadra} ${r.avversario}`.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `riepilogo_${base || "partita"}.pdf`;
}

function ePossibileSuWeb(): boolean {
  return Platform.OS === "web" && typeof document !== "undefined" && typeof Blob !== "undefined";
}

/** Scarica il PDF dal browser. Ritorna false se non si e' su web o qualcosa e' andato storto. */
export function scaricaRiepilogoPdf(r: RiepilogoPartita): boolean {
  if (!ePossibileSuWeb()) return false;
  try {
    const blob = new Blob([costruisciPdfRiepilogo(r) as unknown as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeFileRiepilogo(r);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}

export type EsitoCondivisione = "condiviso" | "scaricato" | "annullato" | "errore";

interface NavigatorCondivisione {
  share?: (dati: { title?: string; text?: string; files?: File[] }) => Promise<void>;
  canShare?: (dati: { files?: File[] }) => boolean;
}

/**
 * Condivide il PDF: dal telefono (browser) apre il foglio di condivisione con il file allegato
 * (chat, mail...). Se il browser non sa condividere file, scarica il PDF. Nell'app nativa
 * condivide il riepilogo come testo.
 */
export async function condividiRiepilogoPdf(r: RiepilogoPartita): Promise<EsitoCondivisione> {
  const titolo = `${r.squadra} vs ${r.avversario}`;
  if (!ePossibileSuWeb()) {
    try {
      await Share.share({ message: testoRiepilogo(r), title: titolo });
      return "condiviso";
    } catch {
      return "errore";
    }
  }
  const nav = (typeof navigator !== "undefined" ? navigator : {}) as NavigatorCondivisione;
  try {
    if (typeof nav.share === "function" && typeof File !== "undefined") {
      const file = new File([costruisciPdfRiepilogo(r) as unknown as BlobPart], nomeFileRiepilogo(r), { type: "application/pdf" });
      if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: `Riepilogo ${titolo}`, text: `Riepilogo ${titolo} - ${r.data}` });
        return "condiviso";
      }
    }
  } catch (e) {
    if ((e as { name?: string })?.name === "AbortError") return "annullato";
    // Altro errore: si ripiega sul download qui sotto.
  }
  return scaricaRiepilogoPdf(r) ? "scaricato" : "errore";
}
