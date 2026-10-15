import { Platform, Share } from "react-native";

/** Tutto cio' che finisce nella scheda partita esportata: gli stessi numeri che si vedono a schermo. */
export interface SchedaPartita {
  titolo: string;
  dataPartita: string;
  setGiocati: { numero: number; noi: number; avv: number }[];
  fondamentali: { nome: string; azioni: number; punti: number; errori: number; efficienza: number | null }[];
  sideOutBreakPoint: { breakPointPct: number | null; sideOutPct: number | null } | null;
  persone: {
    nome: string;
    azioni: number;
    punti: number;
    errori: number;
    saldo: number;
    fondamentali: { nome: string; azioni: number; punti: number; neutri: number; errori: number }[];
  }[];
  timeouts: { set: number; squadra: string; punteggio: string }[];
  serie: { set: number; noi: number; avversario: number }[];
  zone: { fondamentale: string; vista: string; zona: number; azioni: number; punti: number; errori: number }[];
}

function eff(punti: number, errori: number, azioni: number): string {
  return azioni > 0 ? ((punti - errori) / azioni).toFixed(2) : "";
}

function nomeFile(scheda: SchedaPartita, estensione: string): string {
  const base = scheda.titolo.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `scheda_${base || "partita"}.${estensione}`;
}

function cella(v: string | number | null): string {
  const s = v === null ? "" : String(v);
  return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV con separatore ";" (si apre direttamente in Excel italiano). */
export function costruisciCsv(scheda: SchedaPartita): string {
  const righe: (string | number | null)[][] = [];
  righe.push([scheda.titolo]);
  righe.push([scheda.dataPartita]);
  righe.push([]);

  righe.push(["PUNTEGGIO PER SET"]);
  righe.push(["Set", "Noi", "Loro"]);
  for (const s of scheda.setGiocati) righe.push([s.numero, s.noi, s.avv]);
  righe.push([]);

  righe.push(["EFFICIENZA PER FONDAMENTALE"]);
  righe.push(["Fondamentale", "Azioni", "Punti", "Errori", "Efficienza"]);
  for (const f of scheda.fondamentali) righe.push([f.nome, f.azioni, f.punti, f.errori, f.efficienza === null ? "" : f.efficienza.toFixed(2)]);
  righe.push([]);

  if (scheda.sideOutBreakPoint) {
    righe.push(["SIDE-OUT E BREAK-POINT"]);
    righe.push(["Break-point %", scheda.sideOutBreakPoint.breakPointPct ?? ""]);
    righe.push(["Side-out %", scheda.sideOutBreakPoint.sideOutPct ?? ""]);
    righe.push([]);
  }

  righe.push(["CONTRIBUTO INDIVIDUALE"]);
  righe.push(["Giocatrice", "Fondamentale", "Azioni", "Punti", "Neutri", "Errori", "Efficienza"]);
  for (const p of scheda.persone) {
    if (p.fondamentali.length === 0) {
      righe.push([p.nome, "Totale", p.azioni, p.punti, "", p.errori, eff(p.punti, p.errori, p.azioni)]);
      continue;
    }
    for (const f of p.fondamentali) righe.push([p.nome, f.nome, f.azioni, f.punti, f.neutri, f.errori, eff(f.punti, f.errori, f.azioni)]);
  }
  righe.push([]);

  if (scheda.timeouts.length > 0) {
    righe.push(["TIME-OUT"]);
    righe.push(["Set", "Chi", "Punteggio"]);
    for (const t of scheda.timeouts) righe.push([t.set, t.squadra, t.punteggio]);
    righe.push([]);
  }

  if (scheda.zone.length > 0) {
    righe.push(["ZONE DI BATTUTA E ATTACCO"]);
    righe.push(["Fondamentale", "Vista", "Zona", "Azioni", "Punti", "Errori", "Efficienza"]);
    for (const z of scheda.zone) righe.push([z.fondamentale, z.vista, z.zona, z.azioni, z.punti, z.errori, eff(z.punti, z.errori, z.azioni)]);
    righe.push([]);
  }

  if (scheda.serie.length > 0) {
    righe.push(["SERIE PIU' LUNGHE DI PUNTI CONSECUTIVI"]);
    righe.push(["Set", "Noi", "Loro"]);
    for (const s of scheda.serie) righe.push([s.set, s.noi, s.avversario]);
  }

  return righe.map((r) => r.map(cella).join(";")).join("\r\n");
}

function esc(s: string | number): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function tabella(intestazioni: string[], righe: (string | number)[][]): string {
  const th = intestazioni.map((h) => `<th>${esc(h)}</th>`).join("");
  const tr = righe.map((r) => `<tr>${r.map((c, i) => `<td${i > 0 ? ' class="n"' : ""}>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** Pagina HTML pronta da stampare (o salvare in PDF dal browser). */
export function costruisciHtmlStampa(scheda: SchedaPartita): string {
  const parti: string[] = [];
  parti.push(`<h1>${esc(scheda.titolo)}</h1><p class="sotto">${esc(scheda.dataPartita)}</p>`);
  if (scheda.setGiocati.length > 0) {
    parti.push("<h2>Punteggio per set</h2>" + tabella(["Set", "Noi", "Loro"], scheda.setGiocati.map((s) => [s.numero, s.noi, s.avv])));
  }
  if (scheda.fondamentali.length > 0) {
    parti.push(
      "<h2>Efficienza per fondamentale</h2>" +
        tabella(["Fondamentale", "Azioni", "Punti", "Errori", "Efficienza"], scheda.fondamentali.map((f) => [f.nome, f.azioni, f.punti, f.errori, f.efficienza === null ? "—" : f.efficienza.toFixed(2)])),
    );
  }
  if (scheda.sideOutBreakPoint) {
    parti.push(
      "<h2>Side-out e break-point</h2>" +
        tabella(["Misura", "Valore"], [
          ["Break-point (punti vinti in battuta)", scheda.sideOutBreakPoint.breakPointPct !== null ? `${scheda.sideOutBreakPoint.breakPointPct}%` : "—"],
          ["Side-out (punti vinti in ricezione)", scheda.sideOutBreakPoint.sideOutPct !== null ? `${scheda.sideOutBreakPoint.sideOutPct}%` : "—"],
        ]),
    );
  }
  if (scheda.persone.length > 0) {
    const righe: (string | number)[][] = [];
    for (const p of scheda.persone) {
      if (p.fondamentali.length === 0) righe.push([p.nome, "Totale", p.azioni, p.punti, "", p.errori, eff(p.punti, p.errori, p.azioni) || "—"]);
      else for (const f of p.fondamentali) righe.push([p.nome, f.nome, f.azioni, f.punti, f.neutri, f.errori, eff(f.punti, f.errori, f.azioni) || "—"]);
    }
    parti.push("<h2>Contributo individuale</h2>" + tabella(["Giocatrice", "Fondamentale", "Az.", "Pt", "Neu", "Err", "Eff."], righe));
  }
  if (scheda.timeouts.length > 0) {
    parti.push("<h2>Time-out</h2>" + tabella(["Set", "Chi", "Punteggio"], scheda.timeouts.map((t) => [t.set, t.squadra, t.punteggio])));
  }
  if (scheda.zone.length > 0) {
    parti.push(
      "<h2>Zone di battuta e attacco</h2>" +
        tabella(["Fondamentale", "Vista", "Zona", "Az.", "Pt", "Err", "Eff."], scheda.zone.map((z) => [z.fondamentale, z.vista, z.zona, z.azioni, z.punti, z.errori, eff(z.punti, z.errori, z.azioni) || "—"])),
    );
  }
  if (scheda.serie.length > 0) {
    parti.push("<h2>Serie più lunghe di punti consecutivi</h2>" + tabella(["Set", "Noi", "Loro"], scheda.serie.map((s) => [s.set, s.noi, s.avversario])));
  }
  parti.push('<p class="sotto">Efficienza = (punti − errori) / azioni.</p>');

  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(scheda.titolo)}</title>
<style>
body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:24px;font-size:13px}
h1{font-size:20px;margin:0 0 2px}h2{font-size:14px;margin:18px 0 6px;border-bottom:1px solid #999;padding-bottom:2px}
.sotto{color:#555;margin:2px 0}
table{border-collapse:collapse;width:100%;margin-bottom:6px}th,td{border:1px solid #bbb;padding:3px 6px;text-align:left}
th{background:#eee}td.n{text-align:right}
@media print{body{margin:10mm}}
</style></head><body>${parti.join("")}</body></html>`;
}

/**
 * Scarica il CSV (browser) oppure apre la condivisione del testo (app).
 * Ritorna false se non e' stato possibile.
 */
export async function esportaCsv(scheda: SchedaPartita): Promise<boolean> {
  const csv = costruisciCsv(scheda);
  if (Platform.OS === "web" && typeof document !== "undefined") {
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nomeFile(scheda, "csv");
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  }
  try {
    await Share.share({ message: csv, title: scheda.titolo });
    return true;
  } catch {
    return false;
  }
}

/** Apre la scheda in una finestra pronta per "Stampa" / "Salva come PDF" (solo da browser). */
export function stampaScheda(scheda: SchedaPartita): boolean {
  if (Platform.OS !== "web" || typeof window === "undefined") return false;
  const finestra = window.open("", "_blank");
  if (!finestra) return false;
  finestra.document.open();
  finestra.document.write(costruisciHtmlStampa(scheda));
  finestra.document.close();
  finestra.focus();
  setTimeout(() => { try { finestra.print(); } catch { /* l'utente puo' stampare a mano */ } }, 400);
  return true;
}
