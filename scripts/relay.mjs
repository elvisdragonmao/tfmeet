import { baseIdentityKey, identity } from "./identity.mjs";

const bibKey = bib =>
	String(bib || "")
		.trim()
		.replace(/^0+(?=\d)/, "");
const nameKey = name =>
	name
		.normalize("NFKC")
		.toUpperCase()
		.replace(/[\s\p{Dash_Punctuation}]/gu, "");
const teamKey = team => team.normalize("NFKC").replace(/\s/g, "").replace(/臺/g, "台");
const knownSex = gender => gender === "M" || gender === "F";

export function suspectRelayTime(event, performance, value) {
	if (value === null) return false;
	const clock = performance.match(/^\s*\d+(?::\d+){1,2}(?:\.\d+)?/);
	// Preserve source timing errors without stretching the team's performance distribution.
	return (
		Boolean(
			clock?.[0]
				.split(":")
				.slice(1)
				.some(part => Number(part) >= 60)
		) ||
		(event === "4×100M接力" && value >= 120)
	);
}

export function relayRoster(record) {
	const cell = Object.entries(record.fields || {}).find(([header]) => /選手|姓名|ATHLETE|NAME/i.test(header.replace(/\s/g, "")))?.[1];
	const members = [];
	for (const match of (cell || "").normalize("NFKC").matchAll(/(\d{3,6})\s*([\p{L}][\p{L}\p{M} .·・'’\p{Dash_Punctuation}]*)(?:\(([^()]*)\))?/gu)) {
		const [, bib, rawName, year] = match;
		const name = rawName.trim();
		if ([...name.matchAll(/\p{L}/gu)].length < 2) continue;
		const birthYear = /^(19|20)\d{2}$/.test(year?.trim()) && record.year - Number(year) >= 5 && record.year - Number(year) <= 100 ? Number(year) : null;
		members.push({ bib, name, birthYear });
	}
	return members;
}

export function meetRegistrations(records) {
	const byBib = new Map();
	for (const row of records) {
		if (!["individual", "combined", "combined-component"].includes(row.kind) || !row.bib || !knownSex(row.gender) || row.nameProvided === false) continue;
		const key = bibKey(row.bib);
		if (!byBib.has(key)) byBib.set(key, []);
		byBib.get(key).push(row);
	}
	return byBib;
}

export function resolveRelayMember(member, relay, registrations, ambiguous, aliases) {
	const sameRegistration = (registrations.get(bibKey(member.bib)) || []).filter(row => nameKey(row.name) === nameKey(member.name));
	const matches = sameRegistration.filter(
		row =>
			(!knownSex(relay.gender) || row.gender === relay.gender) &&
			(!member.birthYear || !row.birthYear || row.birthYear === member.birthYear) &&
			(!row.team || !relay.team || teamKey(row.team) === teamKey(relay.team))
	);
	const resolved = new Map(matches.map(row => [identity(row, ambiguous, aliases).id, row]));
	if (resolved.size === 1) return resolved.values().next().value;
	if (sameRegistration.length || !knownSex(relay.gender) || !member.birthYear) return null;
	const row = { ...relay, ...member, fields: {} };
	return ambiguous.has(baseIdentityKey(row)) ? null : row;
}
