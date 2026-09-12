export type Fondamentale = "Battuta" | "Ricezione" | "Attacco" | "Muro" | "Difesa";
export type Ruolo = "allenatore" | "vice_allenatore" | "presidente" | "atleta";
export type RuoloCampo = "Palleggiatore" | "Schiacciatore" | "Opposto" | "Centrale" | "Libero";
export type OrigineValutazione = "manuale" | "ai_approvata" | "ai_modificata";
export type StatoProposta = "proposta" | "approvata" | "modificata" | "rigettata";
export type StatoStagione = "pianificata" | "attiva" | "conclusa";
export type Skill = "Servizio" | "Ricezione" | "Attacco" | "Muro" | "Difesa" | "Punto_avversario";
export type Esito = "punto" | "neutro" | "errore";
export type StatoMatch = "programmata" | "in_corso" | "conclusa";

export interface Team {
  id: string;
  nome: string;
  creato_da: string | null;
  creato_il: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
  ruolo: Ruolo;
  atleta_id: string | null;
  creato_il: string;
}

export interface Athlete {
  id: string;
  team_id: string;
  nome: string;
  cognome: string;
  ruolo_campo: RuoloCampo | null;
  numero_maglia: number | null;
  data_nascita: string | null;
  codice_fiscale: string | null;
  numero_licenza: string | null;
  scadenza_certificato_medico: string | null;
  status: "attiva" | "archiviata";
  telefono: string | null;
  email_contatto: string | null;
  note_personali: string | null;
  creato_il: string;
}

export interface Exercise {
  id: string;
  team_id: string;
  nome: string;
  categoria: string | null;
  descrizione: string;
  creato_il: string;
}

export interface Training {
  id: string;
  team_id: string;
  data: string;
  titolo: string;
  note: string;
  argomento: string | null;
  durata_totale_minuti: number | null;
  sporteasy_uid: string | null;
  creato_il: string;
}

export interface TrainingExercise {
  id: string;
  training_id: string;
  exercise_id: string;
  serie: number | null;
  ripetizioni: string | null;
  note: string;
  ordine: number;
  durata_minuti: number | null;
}

export interface Attendance {
  id: string;
  training_id: string;
  athlete_id: string;
  presente: boolean;
  motivo_assenza: string;
  registrato_il: string;
}

export interface Rpe {
  id: string;
  training_id: string;
  athlete_id: string;
  valore: number;
  registrato_il: string;
}

export interface Evaluation {
  id: string;
  team_id: string;
  athlete_id: string;
  fondamentale: Fondamentale;
  punteggio: number;
  note: string;
  valutatore: string | null;
  origine: OrigineValutazione;
  data_valutazione: string;
  creato_il: string;
}

export interface EvaluationProposal {
  id: string;
  team_id: string;
  athlete_id: string;
  fondamentale: Fondamentale;
  valore_attuale: number | null;
  valore_proposto: number;
  confidenza: "bassa" | "media" | "alta";
  motivazione: string;
  provider_usato: string | null;
  stato: StatoProposta;
  valutazione_id: string | null;
  creata_il: string;
  decisa_il: string | null;
  decisa_da: string | null;
}

export interface Season {
  id: string;
  team_id: string;
  nome: string;
  stato: StatoStagione;
  data_apertura: string;
  data_chiusura: string | null;
  creata_il: string;
  creata_da: string | null;
}

export interface SeasonBaseline {
  id: string;
  season_id: string;
  athlete_id: string;
  fondamentale: Fondamentale;
  valore_baseline: number;
  valutazione_id_riferimento: string | null;
  creata_il: string;
  creata_da: string | null;
}

export interface Match {
  id: string;
  team_id: string;
  avversario: string;
  data: string;
  luogo: "casa" | "trasferta";
  stato: StatoMatch;
  set_vinti_noi: number;
  set_vinti_avversario: number;
  sporteasy_uid: string | null;
  campionato_id: string | null;
  tipo_gara: "campionato" | "amichevole";
  creato_il: string;
  creato_da: string | null;
}

export interface Campionato {
  id: string;
  team_id: string;
  nome: string;
  federazione: "FIPAV" | "PGS" | "CSI" | "ALTRO";
  punti_per_set: number;
  punti_set_decisivo: number;
  numero_liberi_max: number;
  numero_sostituzioni_max_per_set: number;
  numero_maglia_max: number;
  distinta_min_giocatrici: number;
  distinta_max_giocatrici: number;
  data_inizio: string | null;
  data_fine: string | null;
  attivo: boolean;
  creato_il: string;
}

export interface MatchConvocato {
  id: string;
  match_id: string;
  athlete_id: string;
  is_libero: boolean;
}

export interface TeamIntegration {
  team_id: string;
  sporteasy_ical_url: string | null;
  ultima_sincronizzazione: string | null;
  ultimo_esito: string | null;
}

export interface MatchSet {
  id: string;
  match_id: string;
  numero_set: number;
  punti_noi: number;
  punti_avversario: number;
  concluso: boolean;
  squadra_al_servizio: "noi" | "avversario" | null;
  chi_ha_servito_per_primo: "noi" | "avversario" | null;
}

export interface MatchEvent {
  id: string;
  match_id: string;
  set_id: string;
  skill: Skill;
  esito: Esito | null;
  athlete_id: string | null;
  creato_il: string;
  creato_da: string | null;
}

export interface MatchSetLineup {
  id: string;
  set_id: string;
  athlete_id: string;
  in_campo: boolean;
  posizione: number | null;
  aggiornato_il: string;
}

export interface PianoAnnuale {
  id: string;
  team_id: string;
  season_id: string | null;
  titolo: string;
  contenuto: string;
  generato_da_ai: boolean;
  ultima_proposta_il: string | null;
  creato_il: string;
  aggiornato_il: string;
}

export interface PropostaAggiornamentoPiano {
  id: string;
  piano_id: string;
  contenuto_proposto: string;
  motivo: string;
  stato: "pendente" | "accettata" | "rifiutata";
  creato_il: string;
  decisa_il: string | null;
}

// Placeholder minimale: non generiamo il tipo Database completo via CLI
// in questo scaffold iniziale (richiede `supabase gen types typescript`
// con un progetto collegato). Da rigenerare al primo `supabase db push`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}
