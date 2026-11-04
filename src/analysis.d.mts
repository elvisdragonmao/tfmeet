import type { Result, Filters } from "./types";
export function quantile(sorted: number[], p: number): number | null;
export function formatResult(value: number | null | undefined, unit?: string): string;
export function bestPerAthlete(records: Result[], lower?: boolean): Result[];
export function comparePool(records: Result[], filters: Filters): Result[];
export function standing(records: Result[], value: number, lower?: boolean): { rank: number; n: number; topPercent: number; beatsPercent: number } | null;
export function threshold(records: Result[], percent: number, lower?: boolean): number | null;
export function groupStats(
	records: Result[],
	key: keyof Result,
	lower?: boolean
): { key: number; n: number; median: number | null; top10: number | null; top25: number | null; top75: number | null; best: number | null }[];
export function parseInput(text: string, unit?: string): number | null;

export function uniqueStarts(records: Result[]): Result[];
