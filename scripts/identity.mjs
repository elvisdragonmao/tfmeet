import { createHash } from "node:crypto";
// Add an exception only with a public evidence URL and an explanation.
// Do not infer a birth year, grade, or school transition from a matching name alone.
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
export function identity(record, ambiguous = null) {
	const override = identityOverrides.find(o => o.match(record));
	if (override && (!override.evidence || !override.reason)) throw new Error("Identity overrides require evidence and reason");
	const base = baseIdentityKey(record);
	const conflict = ambiguous?.has(base);
	const key = override?.key || base + (conflict ? `|team:${record.team}` : "");
	return {
		displayName: override?.displayName || record.name,
		evidence: override?.evidence || [],
		id: createHash("sha256").update(key).digest("hex").slice(0, 20),
		basis: override ? "verified-override" : conflict ? "name-gender-birth-team" : record.birthYear ? "name-gender-birth-year" : "name-gender-team"
	};
}
export function baseIdentityKey(record) {
	return [record.name.normalize("NFKC").trim(), record.gender, record.birthYear || `team:${record.team.normalize("NFKC").trim()}`].join("|");
}
export function registerIdentity(registrations, r) {
	if (r.kind !== "individual" || !r.birthYear || !r.bib) return;
	const key = baseIdentityKey(r),
		registrationKey = `${key}|${r.meetId}`;
	if (!registrations.has(registrationKey)) registrations.set(registrationKey, { key, bibs: new Set(), teams: new Set() });
	const entry = registrations.get(registrationKey);
	entry.bibs.add(r.bib);
	entry.teams.add(r.team);
}
export function ambiguousIdentities(registrations) {
	return new Set([...registrations.values()].filter(r => r.bibs.size > 1 && r.teams.size > 1).map(r => r.key));
}
