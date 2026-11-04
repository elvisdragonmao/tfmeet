export interface Result {
	id: string;
	athleteId: string;
	meetId: string;
	item: string;
	date: string | null;
	year: number;
	event: string;
	group: string;
	round: string;
	gender: string;
	name: string;
	team: string;
	bib: string;
	birthYear: number | null;
	age: number | null;
	ageBasis: string | null;
	grade: string | null;
	kind: string;
	performance: string;
	value: number | null;
	rank: string | null;
	heat: string | null;
	wind: number | null;
	source?: string;
}
export interface EventInfo {
	id: string;
	name: string;
	gender: string;
	unit: string;
	lowerIsBetter: boolean;
	count: number;
	valid: number;
	years: number[];
}
export interface EventData extends Pick<EventInfo, "id" | "name" | "gender" | "unit" | "lowerIsBetter"> {
	records: Result[];
	sources: Record<string, string>;
}
export interface Meet {
	warnings?: { code: string; message: string; url: string }[];
	id: string;
	name?: string;
	category: string;
	year: number;
	url: string;
	status: string;
	sessionCount: number;
	pages: number;
	records: number;
	errors: { item?: string; url: string; message: string }[];
	fetchedAt: string;
}
export interface Manifest {
	restricted?: number;
	schemaVersion: number;
	updatedAt: string;
	derivedAt: string;
	source: string;
	discovered: number;
	complete: number;
	partial: number;
	recordCount: number;
	athleteCount: number;
	withAge: number;
	meets: Meet[];
	events: EventInfo[];
	archiveUrl: string;
}
export interface Athlete {
	aliases: string[];
	evidence: string[];
	id: string;
	name: string;
	gender: string;
	birthYear: number | null;
	basis: string;
	teams: string[];
	events: string[];
	years: number[];
	count: number;
}
export interface Filters {
	gender: string;
	group: string;
	from: number;
	to: number;
	age: string;
	wind: string;
	round: string;
	team: string;
}
