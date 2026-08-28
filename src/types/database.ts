export type Fondamentale = "Battuta" | "Ricezione" | "Attacco" | "Muro" | "Difesa";
export type Ruolo = "allenatore" | "vice_allenatore";
export type OrigineValutazione = "manuale" | "ai_approvata" | "ai_modificata";
export type StatoProposta = "proposta" | "approvata" | "modificata" | "rigettata";
export type StatoStagione = "pianificata" | "attiva" | "conclusa";

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
  ruolo_campo: string | null;
  numero_maglia: number | null;
  data_nascita: string | null;
  status: "attiva" | "archiviata";
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

// Placeholder minimale: non generiamo il tipo Database completo via CLI
// in questo scaffold iniziale (richiede `supabase gen types typescript`
// con un progetto collegato). Da rigenerare al primo `supabase db push`.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Database {}
