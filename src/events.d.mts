export const dataRulesVersion: number;
export function normalizeEvent(source: string): { family: string; specification: number | null; unit: "points" | "s" | "m" };
export function normalizeSpecification(family: string, size: number | null): number | null;
export function normalizeGroup(group: string, gender: string, event?: string): string;
export function inferSpecification(family: string, group: string, gender: string, age: number | null): number | null;
export function specificationLabel(family: string, size: number): string;
