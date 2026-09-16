import * as XLSX from "xlsx";
import { creaAtleta, aggiornaAtleta } from "@/src/services/athletes";
import { ruoliCampo } from "@/src/config";
import type { Athlete, RuoloCampo } from "@/src/types/database";

/** Campi anagrafici che il wizard sa importare/aggiornare. */
export type CampoImportabile =
  | "nome" | "cognome" | "codice_fiscale" | "ruolo_campo" | "numero_maglia" | "data_nascita"
  | "telefono" | "email_contatto" | "numero_licenza" | "scadenza_certificato_medico";

export const CAMPI_IMPORTABILI: { campo: CampoImportabile; etichetta: string; obbligatorio: boolean }[] = [
  { campo: "nome", etichetta: "Nome", obbligatorio: true },
  { campo: "cognome", etichetta: "Cognome", obbligatorio: true },
  { campo: "codice_fiscale", etichetta: "Codice fiscale", obbligatorio: false },
  { campo: "ruolo_campo", etichetta: "Ruolo in campo / Posizione", obbligatorio: false },
  { campo: "numero_maglia", etichetta: "Numero maglia", obbligatorio: false },
  { campo: "data_nascita", etichetta: "Data di nascita", obbligatorio: false },
  { campo: "telefono", etichetta: "Telefono", obbligatorio: false },
  { campo: "email_contatto", etichetta: "Email", obbligatorio: false },
  { campo: "numero_licenza", etichetta: "Numero di licenza", obbligatorio: false },
  { campo: "scadenza_certificato_medico", etichetta: "Scadenza certificato medico", obbligatorio: false },
];

// Un campo "filtro", non salvato in athletes: se una colonna del file
// corrisponde a questi sinonimi ("Impiego" nell'export SportEasy reale),
// le righe il cui valore non somiglia a "giocatore/giocatrice/atleta"
// vengono scartate in automatico (staff, dirigenti, allenatori...)
// invece di dover essere deselezionate una per una a mano.
const SINONIMI_FILTRO_TIPO_PERSONA = ["impiego", "ruolopersona", "tipo", "type", "categoria"];
// Radici normalizzate che indicano "questa persona gioca": basta che il
// valore della colonna Impiego ne contenga una (copre "Giocatore",
// "Giocatrice", "Atleta", "Player" in qualunque forma/plurale).
const RADICI_GIOCATORE = ["giocat", "atlet", "player"];

// Sinonimi noti per il matching automatico (confrontati dopo normalizzazione: minuscolo, senza spazi/accenti/punteggiatura).
const SINONIMI: Record<CampoImportabile, string[]> = {
  nome: ["nome", "name", "firstname", "first"],
  cognome: ["cognome", "surname", "lastname", "last"],
  codice_fiscale: ["codicefiscale", "cf", "codfisc", "fiscalcode", "taxcode"],
  ruolo_campo: ["ruolo", "ruoloincampo", "posizione", "position", "role"],
  numero_maglia: ["numeromaglia", "maglia", "jersey", "jerseynumber"],
  data_nascita: ["datanascita", "nascita", "dob", "dateofbirth", "birthdate"],
  telefono: ["telefono", "cellulare", "phone", "mobile", "tel"],
  email_contatto: ["email", "mail", "emailaddress"],
  numero_licenza: ["numerolicenza", "licenza", "license", "numerotessera", "tessera"],
  scadenza_certificato_medico: ["scadenzacertificatomedico", "certificatomedico", "certmedico", "scadenzacertmedico", "medicalcertificate"],
};

// Il ruolo campo di SportEasy usa nomi più estesi dei nostri ("Schiacciatore
// laterale" invece di "Schiacciatore"): normalizziamo qui prima del confronto.
const MAPPATURA_RUOLO_CAMPO: Record<string, RuoloCampo> = {
  "schiacciatorelaterale": "Schiacciatore",
  "schiacciatore": "Schiacciatore",
  "banda": "Schiacciatore",
  "schiacciatoreopposto": "Opposto",
  "opposto": "Opposto",
  "centrale": "Centrale",
  "palleggiatore": "Palleggiatore",
  "alzatore": "Palleggiatore",
  "libero": "Libero",
};

function normalizza(testo: string): string {
  return testo
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // rimuove accenti
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Chiave di dedup: codice fiscale se presente, altrimenti nome+cognome concatenati — entrambi normalizzati per non farsi ingannare da maiuscole/spazi/accenti diversi. */
export function chiaveAtleta(nome: string, cognome: string, codiceFiscale?: string | null): string {
  if (codiceFiscale && codiceFiscale.trim()) return "cf:" + normalizza(codiceFiscale);
  return "nc:" + normalizza(nome) + "|" + normalizza(cognome);
}

export interface FileLetto {
  intestazioni: string[];
  righe: Record<string, string>[];
}

/** Legge un file Excel (.xlsx/.xls) o CSV: ArrayBuffer su web, stringa base64 su nativo (expo-file-system la fornisce così). */
export function leggiFileExcel(dati: ArrayBuffer | string, formato: "array" | "base64" = "array"): FileLetto {
  const workbook = XLSX.read(dati, { type: formato });
  const primoFoglio = workbook.SheetNames[0];
  const foglio = workbook.Sheets[primoFoglio];
  const righeGrezze: string[][] = XLSX.utils.sheet_to_json(foglio, { header: 1, raw: false, defval: "" });

  if (righeGrezze.length === 0) return { intestazioni: [], righe: [] };
  // Le intestazioni duplicate (es. "Città di residenza" compare due
  // volte in un export SportEasy reale) vanno rese uniche, altrimenti
  // Object.fromEntries qui sotto terrebbe solo l'ultima e la mappatura
  // per nome colonna diventerebbe ambigua.
  const intestazioniGrezze = righeGrezze[0].map((h) => String(h ?? "").trim());
  const contatore: Record<string, number> = {};
  const intestazioni = intestazioniGrezze.map((h) => {
    contatore[h] = (contatore[h] ?? 0) + 1;
    return contatore[h] > 1 ? `${h} (${contatore[h]})` : h;
  });

  const righe = righeGrezze.slice(1)
    .filter((r) => r.some((cella) => String(cella ?? "").trim() !== ""))
    .map((r) => Object.fromEntries(intestazioni.map((h, i) => [h, String(r[i] ?? "").trim()])));

  return { intestazioni, righe };
}

/** Per ogni campo importabile, propone la colonna del file che sembra corrispondergli meglio (o null se nessuna). Confronto per sottostringa (non solo esatto): "N° maglia" normalizzato è "nmaglia", che contiene "maglia" pur non coincidendo esattamente — un confronto solo-esatto lo avrebbe mancato. */
export function abbinaColonneAutomaticamente(intestazioni: string[]): Record<CampoImportabile, string | null> {
  const risultato = {} as Record<CampoImportabile, string | null>;
  for (const { campo } of CAMPI_IMPORTABILI) {
    const sinonimiNormalizzati = SINONIMI[campo].map(normalizza);
    // Preferisce una corrispondenza esatta; se non c'è, accetta una
    // sottostringa (in entrambe le direzioni) — più permissivo ma
    // ancora specifico abbastanza da non confondere campi diversi.
    let trovata = intestazioni.find((h) => sinonimiNormalizzati.includes(normalizza(h)));
    if (!trovata) {
      trovata = intestazioni.find((h) => {
        const hNorm = normalizza(h);
        return sinonimiNormalizzati.some((s) => hNorm.includes(s) || s.includes(hNorm));
      });
    }
    risultato[campo] = trovata ?? null;
  }
  return risultato;
}

/** Trova la colonna "Impiego" (o simili) per il filtro automatico staff/giocatrici, con lo stesso criterio elastico di sopra. */
export function trovaColonnaFiltroTipoPersona(intestazioni: string[]): string | null {
  const normalizzati = SINONIMI_FILTRO_TIPO_PERSONA.map(normalizza);
  let trovata = intestazioni.find((h) => normalizzati.includes(normalizza(h)));
  if (!trovata) trovata = intestazioni.find((h) => normalizzati.some((s) => normalizza(h).includes(s)));
  return trovata ?? null;
}

export interface CampoValorizzato {
  campo: CampoImportabile;
  valoreFile: string;
  valoreAttuale: string;
  diverso: boolean;
}

export interface RigaAnalizzata {
  chiave: string;
  datiFile: Partial<Record<CampoImportabile, string>>;
  atletaEsistente: Athlete | null;
  campiDiversi: CampoValorizzato[];
  tipo: "nuova" | "aggiornamento" | "invariata" | "errore" | "saltata";
  errore?: string;
  selezionata: boolean;
}

function valoreTestualeCampo(a: Athlete, campo: CampoImportabile): string {
  switch (campo) {
    case "nome": return a.nome ?? "";
    case "cognome": return a.cognome ?? "";
    case "codice_fiscale": return a.codice_fiscale ?? "";
    case "ruolo_campo": return a.ruolo_campo ?? "";
    case "numero_maglia": return a.numero_maglia != null ? String(a.numero_maglia) : "";
    case "data_nascita": return a.data_nascita ?? "";
    case "telefono": return a.telefono ?? "";
    case "email_contatto": return a.email_contatto ?? "";
    case "numero_licenza": return a.numero_licenza ?? "";
    case "scadenza_certificato_medico": return a.scadenza_certificato_medico ?? "";
  }
}

/** Converte un ruolo campo letto dal file (qualunque dicitura) nel valore standard dell'app, o null se non riconosciuto (mai bloccante: la riga resta importabile, solo senza ruolo). */
function normalizzaRuoloCampo(valoreFile: string | undefined): RuoloCampo | null {
  if (!valoreFile) return null;
  const daMappa = MAPPATURA_RUOLO_CAMPO[normalizza(valoreFile)];
  if (daMappa) return daMappa;
  if ((ruoliCampo as readonly string[]).includes(valoreFile)) return valoreFile as RuoloCampo;
  return null;
}

/**
 * Confronta ogni riga del file con la rosa già censite (dedup su
 * codice fiscale, fallback nome+cognome) e prepara il riepilogo che il
 * wizard mostrerà per la conferma. Se è stata indicata una colonna
 * "tipo persona" (Impiego), le righe che non sembrano una giocatrice
 * (staff, dirigenti, allenatori) vengono marcate "saltata" invece che
 * proposte per l'importazione.
 */
export function analizzaRighe(
  righe: Record<string, string>[],
  mappatura: Record<CampoImportabile, string | null>,
  atleteEsistenti: Athlete[],
  colonnaFiltroTipoPersona?: string | null,
): RigaAnalizzata[] {
  const indiceEsistenti = new Map<string, Athlete>();
  for (const a of atleteEsistenti) {
    indiceEsistenti.set(chiaveAtleta(a.nome, a.cognome, a.codice_fiscale), a);
  }

  return righe.map((riga): RigaAnalizzata => {
    if (colonnaFiltroTipoPersona) {
      const valoreTipo = riga[colonnaFiltroTipoPersona]?.trim();
      const valoreNormalizzato = valoreTipo ? normalizza(valoreTipo) : "";
      const sembraGiocatrice = !valoreTipo || RADICI_GIOCATORE.some((radice) => valoreNormalizzato.includes(radice));
      if (!sembraGiocatrice) {
        return {
          chiave: "", datiFile: { nome: riga[mappatura.nome ?? ""], cognome: riga[mappatura.cognome ?? ""] },
          atletaEsistente: null, campiDiversi: [], tipo: "saltata",
          errore: `Non è una giocatrice (${colonnaFiltroTipoPersona}: "${valoreTipo}")`, selezionata: false,
        };
      }
    }

    const datiFile: Partial<Record<CampoImportabile, string>> = {};
    for (const { campo } of CAMPI_IMPORTABILI) {
      const colonna = mappatura[campo];
      if (colonna && riga[colonna] !== undefined) datiFile[campo] = riga[colonna];
    }

    if (!datiFile.nome?.trim() || !datiFile.cognome?.trim()) {
      return { chiave: "", datiFile, atletaEsistente: null, campiDiversi: [], tipo: "errore", errore: "Nome e cognome mancanti", selezionata: false };
    }

    const ruoloNormalizzato = normalizzaRuoloCampo(datiFile.ruolo_campo);
    if (ruoloNormalizzato) datiFile.ruolo_campo = ruoloNormalizzato;
    else delete datiFile.ruolo_campo;

    const chiave = chiaveAtleta(datiFile.nome, datiFile.cognome, datiFile.codice_fiscale);
    const esistente = indiceEsistenti.get(chiave) ?? null;

    if (!esistente) {
      return { chiave, datiFile, atletaEsistente: null, campiDiversi: [], tipo: "nuova", selezionata: true };
    }

    const campiDiversi: CampoValorizzato[] = [];
    for (const { campo } of CAMPI_IMPORTABILI) {
      if (datiFile[campo] === undefined) continue;
      const valoreAttuale = valoreTestualeCampo(esistente, campo);
      const valoreFile = datiFile[campo]!;
      if (normalizza(valoreFile) !== normalizza(valoreAttuale)) {
        campiDiversi.push({ campo, valoreFile, valoreAttuale, diverso: true });
      }
    }

    return {
      chiave, datiFile, atletaEsistente: esistente, campiDiversi,
      tipo: campiDiversi.length > 0 ? "aggiornamento" : "invariata",
      selezionata: campiDiversi.length > 0,
    };
  });
}

export interface EsitoImportWizard {
  create: number;
  aggiornate: number;
  errori: { riga: RigaAnalizzata; messaggio: string }[];
}

/** Esegue solo le righe selezionate (nuove + aggiornamenti confermati dalla checkbox). Le righe "invariate"/"saltata"/deselezionate non toccano il database. */
export async function eseguiImportWizard(teamId: string, righe: RigaAnalizzata[]): Promise<EsitoImportWizard> {
  const esito: EsitoImportWizard = { create: 0, aggiornate: 0, errori: [] };

  for (const riga of righe) {
    if (!riga.selezionata || riga.tipo === "errore" || riga.tipo === "invariata" || riga.tipo === "saltata") continue;

    try {
      if (riga.tipo === "nuova") {
        await creaAtleta(teamId, {
          nome: riga.datiFile.nome!,
          cognome: riga.datiFile.cognome!,
          codice_fiscale: riga.datiFile.codice_fiscale || null,
          ruolo_campo: (riga.datiFile.ruolo_campo as RuoloCampo) || null,
          numero_maglia: riga.datiFile.numero_maglia ? Number(riga.datiFile.numero_maglia) || null : null,
          data_nascita: riga.datiFile.data_nascita || null,
          numero_licenza: riga.datiFile.numero_licenza || null,
          scadenza_certificato_medico: riga.datiFile.scadenza_certificato_medico || null,
          telefono: riga.datiFile.telefono || null,
          email_contatto: riga.datiFile.email_contatto || null,
        });
        esito.create++;
      } else if (riga.tipo === "aggiornamento" && riga.atletaEsistente) {
        const patch: Record<string, unknown> = {};
        for (const c of riga.campiDiversi) patch[c.campo] = c.campo === "numero_maglia" ? (Number(c.valoreFile) || null) : c.valoreFile;
        await aggiornaAtleta(riga.atletaEsistente.id, patch);
        esito.aggiornate++;
      }
    } catch (e) {
      esito.errori.push({ riga, messaggio: (e as Error).message });
    }
  }

  return esito;
}
