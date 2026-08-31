import * as XLSX from "xlsx";
import { creaAtleta, aggiornaAtleta } from "@/src/services/athletes";
import { ruoliCampo } from "@/src/config";
import type { Athlete, RuoloCampo } from "@/src/types/database";

/** Campi anagrafici che il wizard sa importare/aggiornare. */
export type CampoImportabile = "nome" | "cognome" | "codice_fiscale" | "ruolo_campo" | "numero_maglia" | "data_nascita" | "telefono" | "email_contatto";

export const CAMPI_IMPORTABILI: { campo: CampoImportabile; etichetta: string; obbligatorio: boolean }[] = [
  { campo: "nome", etichetta: "Nome", obbligatorio: true },
  { campo: "cognome", etichetta: "Cognome", obbligatorio: true },
  { campo: "codice_fiscale", etichetta: "Codice fiscale", obbligatorio: false },
  { campo: "ruolo_campo", etichetta: "Ruolo in campo", obbligatorio: false },
  { campo: "numero_maglia", etichetta: "Numero maglia", obbligatorio: false },
  { campo: "data_nascita", etichetta: "Data di nascita", obbligatorio: false },
  { campo: "telefono", etichetta: "Telefono", obbligatorio: false },
  { campo: "email_contatto", etichetta: "Email", obbligatorio: false },
];

// Sinonimi noti per il matching automatico (confrontati dopo normalizzazione: minuscolo, senza spazi/accenti/punteggiatura).
const SINONIMI: Record<CampoImportabile, string[]> = {
  nome: ["nome", "name", "firstname", "first"],
  cognome: ["cognome", "surname", "lastname", "last"],
  codice_fiscale: ["codicefiscale", "cf", "codfisc", "fiscalcode", "taxcode"],
  ruolo_campo: ["ruolo", "ruoloincampo", "posizione", "position", "role"],
  numero_maglia: ["numero", "numeromaglia", "maglia", "jersey", "jerseynumber", "n"],
  data_nascita: ["datanascita", "nascita", "dob", "dateofbirth", "birthdate"],
  telefono: ["telefono", "cellulare", "phone", "mobile", "tel"],
  email_contatto: ["email", "mail", "emailaddress"],
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
  const intestazioni = righeGrezze[0].map((h) => String(h ?? "").trim());
  const righe = righeGrezze.slice(1)
    .filter((r) => r.some((cella) => String(cella ?? "").trim() !== ""))
    .map((r) => Object.fromEntries(intestazioni.map((h, i) => [h, String(r[i] ?? "").trim()])));

  return { intestazioni, righe };
}

/** Per ogni campo importabile, propone la colonna del file che sembra corrispondergli meglio (o null se nessuna). L'utente può sempre correggere questa proposta prima di procedere. */
export function abbinaColonneAutomaticamente(intestazioni: string[]): Record<CampoImportabile, string | null> {
  const risultato = {} as Record<CampoImportabile, string | null>;
  for (const { campo } of CAMPI_IMPORTABILI) {
    const sinonimiNormalizzati = SINONIMI[campo].map(normalizza);
    const trovata = intestazioni.find((h) => sinonimiNormalizzati.includes(normalizza(h)));
    risultato[campo] = trovata ?? null;
  }
  return risultato;
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
  tipo: "nuova" | "aggiornamento" | "invariata" | "errore";
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
  }
}

/**
 * Confronta ogni riga del file con le atlete già censite (dedup su
 * codice fiscale, fallback nome+cognome) e prepara il riepilogo che il
 * wizard mostrerà per la conferma: nuove atlete, atlete da aggiornare
 * (con i campi diversi evidenziati), atlete già identiche (nessuna
 * azione), e righe con errori di validazione.
 */
export function analizzaRighe(
  righe: Record<string, string>[],
  mappatura: Record<CampoImportabile, string | null>,
  atleteEsistenti: Athlete[],
): RigaAnalizzata[] {
  const indiceEsistenti = new Map<string, Athlete>();
  for (const a of atleteEsistenti) {
    indiceEsistenti.set(chiaveAtleta(a.nome, a.cognome, a.codice_fiscale), a);
  }

  return righe.map((riga): RigaAnalizzata => {
    const datiFile: Partial<Record<CampoImportabile, string>> = {};
    for (const { campo } of CAMPI_IMPORTABILI) {
      const colonna = mappatura[campo];
      if (colonna && riga[colonna] !== undefined) datiFile[campo] = riga[colonna];
    }

    if (!datiFile.nome?.trim() || !datiFile.cognome?.trim()) {
      return { chiave: "", datiFile, atletaEsistente: null, campiDiversi: [], tipo: "errore", errore: "Nome e cognome mancanti", selezionata: false };
    }

    if (datiFile.ruolo_campo && !(ruoliCampo as readonly string[]).includes(datiFile.ruolo_campo)) {
      // Ruolo non riconosciuto: non blocca la riga, semplicemente non lo importa (l'allenatore lo sistemerà a mano dopo).
      delete datiFile.ruolo_campo;
    }

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

/** Esegue solo le righe selezionate (nuove + aggiornamenti confermati dalla checkbox). Le righe "invariate" o deselezionate non toccano il database. */
export async function eseguiImportWizard(teamId: string, righe: RigaAnalizzata[]): Promise<EsitoImportWizard> {
  const esito: EsitoImportWizard = { create: 0, aggiornate: 0, errori: [] };

  for (const riga of righe) {
    if (!riga.selezionata || riga.tipo === "errore" || riga.tipo === "invariata") continue;

    try {
      if (riga.tipo === "nuova") {
        await creaAtleta(teamId, {
          nome: riga.datiFile.nome!,
          cognome: riga.datiFile.cognome!,
          codice_fiscale: riga.datiFile.codice_fiscale || null,
          ruolo_campo: (riga.datiFile.ruolo_campo as RuoloCampo) || null,
          numero_maglia: riga.datiFile.numero_maglia ? Number(riga.datiFile.numero_maglia) || null : null,
          data_nascita: riga.datiFile.data_nascita || null,
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
