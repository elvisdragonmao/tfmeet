import type { PerformanceHistory } from "./prediction.mjs";
import type { Athlete, Result } from "./types";

export interface AthletePredictionSeason extends PerformanceHistory {
	year: number;
	meetDays: number;
}

export function athletePredictionSeasons(athlete: Athlete, event: string, unit: string | undefined, rows: Result[]): AthletePredictionSeason[];
export function missingSeasonTargets(observedYears: number[], seasons: AthletePredictionSeason[], currentYear: number): { year: number; precedingYear: number; source: AthletePredictionSeason }[];
