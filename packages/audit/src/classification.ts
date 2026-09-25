// packages/audit/src/classification.ts  (D1)
export type ReversibilityClass = "reversible" | "compensable" | "irreversible" | "unknown";
export interface ClassifierResult { class: ReversibilityClass; confidence: number; reasons: string[] }
