import { createHash } from "node:crypto";
import { normalizeEvent } from "../src/events.mjs";
// Use the same key for verified aliases, or distinct keys with basis "verified-separation" for verified homonyms.
// Match each exception using the source's identifying fields and include public evidence and a reason.
export const identityOverrides = [
	{
		key: "林昱堂|M|2000",
		displayName: "林昱堂",
		match: r => r.gender === "M" && r.birthYear === 2000 && ["林昱堂", "YUTANGLIN", "LINYUTANG"].includes(r.name.toUpperCase().replace(/[\s-]/g, "")),
		evidence: ["https://worldathletics.org/athletes/_/14831893", "https://w3.athletics.org.tw/twopen2026/score_query_adv.php?action=score&item=210&grp_num=200&subno=17&sub=22&su_no=4&tots=1"],
		reason:
			"The association's 2026 international long-jump results explicitly pair 林昱堂 with YU TANG LIN and birth year 2000; World Athletics corroborates the international name, event and birth date."
	}
];
export function identity(record, ambiguous = null, sourceAliases = null, overrides = identityOverrides) {
	const override = overrides.find(o => o.match(record));
	if (override && (!override.evidence?.length || !override.reason)) throw new Error("Identity overrides require evidence and reason");
	const base = baseIdentityKey(record);
	const conflict = ambiguous?.get(base);
	const alias = override || conflict ? null : matchingSourceName(sourceAliases, record, ambiguous);
	const key =
		override?.key ||
		alias?.key ||
		base + (conflict === "registration" ? `|registration:${record.meetId}:${registrationNumber(record.bib)}` : conflict === "team" ? `|team:${record.team.normalize("NFKC").trim()}` : "");
	return {
		displayName: override?.displayName || alias?.name || record.name,
		evidence: override?.evidence || (alias ? [alias.source] : []),
		id: createHash("sha256").update(key).digest("hex").slice(0, 20),
		basis: override
			? override.basis || "verified-override"
			: alias
				? "verified-source-alias"
				: conflict === "registration"
					? "distinct-start-registrations"
					: conflict === "team"
						? "name-gender-birth-team"
						: record.birthYear
							? "name-gender-birth-year"
							: "name-gender-team"
	};
}
export function baseIdentityKey(record) {
	return [record.name.normalize("NFKC").trim(), record.gender, record.birthYear || `team:${record.team.normalize("NFKC").trim()}`].join("|");
}
const registrationNumber = bib => (bib || "").trim().replace(/^0+(?=\d)/, "");
export function registerIdentity(registrations, r) {
	if (r.kind !== "individual" || !registrationNumber(r.bib) || r.nameProvided === false) return;
	const key = baseIdentityKey(r),
		registrationKey = `${key}|${r.meetId}`;
	if (!registrations.has(registrationKey)) registrations.set(registrationKey, { key, bibs: new Set(), teams: new Set(), starts: new Map(), distinctStart: false });
	const entry = registrations.get(registrationKey);
	const bib = registrationNumber(r.bib);
	const team = r.team.normalize("NFKC").trim();
	entry.bibs.add(bib);
	if (team) entry.teams.add(team);
	if (!r.item || r.value === null) return;
	const start = JSON.stringify([r.item, r.date, r.heat]);
	const previous = entry.starts.get(start);
	if (previous && previous.bib !== bib && (previous.value !== r.value || (previous.rank && r.rank && previous.rank !== r.rank))) entry.distinctStart = true;
	if (!previous) entry.starts.set(start, { bib, value: r.value, rank: r.rank });
}
export function ambiguousIdentities(registrations) {
	const conflicts = new Map();
	for (const entry of registrations.values()) {
		if (entry.distinctStart) conflicts.set(entry.key, "registration");
		else if (entry.bibs.size > 1 && entry.teams.size > 1 && !conflicts.has(entry.key)) conflicts.set(entry.key, "team");
	}
	return conflicts;
}

const romanizedName = /^[\p{Script=Latin}][\p{Script=Latin}\p{Mark} .'’-]*$/u;
const aliasKey = (name, r) =>
	[
		name
			.normalize("NFKD")
			.toUpperCase()
			.replace(/[^A-Z]/g, ""),
		r.gender,
		r.birthYear
	].join("|");
const normalizedTeam = team => team.normalize("NFKC").trim();
const teamAliasKey = (alias, record) => `${alias}|team:${normalizedTeam(record.team)}`;
const internationalAliasKey = alias => `${alias}|international`;

export function sourceNameAlias(record) {
	if (!record.birthYear || !["M", "F"].includes(record.gender) || !/^\p{Script=Han}+$/u.test(record.name)) return null;
	const cell = Object.entries(record.fields || {}).find(([header]) => /^(?:選手|姓名|ATHLETE|NAME)$/i.test(header.replace(/\s/g, "")))?.[1];
	if (!cell?.startsWith(record.name)) return null;
	const suffix = cell.slice(record.name.length).trim();
	const birthYear = String(record.birthYear);
	if (!suffix.startsWith(birthYear)) return null;
	const alias = suffix.slice(birthYear.length).trim();
	return romanizedName.test(alias) && alias.replace(/[^\p{Script=Latin}]/gu, "").length >= 4 ? alias : null;
}

export function registerSourceAlias(aliases, record) {
	const alias = sourceNameAlias(record);
	if (!alias || !record.source || !record.team.trim()) return;
	const key = aliasKey(alias, record);
	const teamKey = teamAliasKey(key, record);
	const identityKey = baseIdentityKey(record);
	const existing = aliases.get(teamKey);
	if (existing === undefined) aliases.set(teamKey, { name: record.name, key: identityKey, source: record.source });
	else if (existing?.key !== identityKey) aliases.set(teamKey, null);

	if (!record.event) return;
	const internationalKey = internationalAliasKey(key);
	if (!aliases.has(internationalKey)) aliases.set(internationalKey, { name: record.name, key: identityKey, events: new Map() });
	const international = aliases.get(internationalKey);
	if (international?.key !== identityKey) {
		aliases.set(internationalKey, null);
		return;
	}
	const { family } = normalizeEvent(record.event);
	if (family && !international.events.has(family)) international.events.set(family, record.source);
}

function matchingSourceName(aliases, record, ambiguous) {
	if (!aliases || !record.birthYear || !romanizedName.test(record.name)) return null;
	const key = aliasKey(record.name, record);
	const sameTeam = aliases.get(teamAliasKey(key, record));
	if (sameTeam !== undefined) return sameTeam && !ambiguous?.has(sameTeam.key) ? sameTeam : null;

	// International results may give the federation code in place of the school or club.
	if (normalizedTeam(record.team).toUpperCase() !== "TPE" || !record.event) return null;
	const match = aliases.get(internationalAliasKey(key));
	if (!match || ambiguous?.has(match.key)) return null;
	const source = match.events.get(normalizeEvent(record.event).family);
	return source ? { name: match.name, key: match.key, source } : null;
}
