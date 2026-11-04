import test from "node:test";
import assert from "node:assert/strict";
import { bestPerAthlete, comparePool, formatResult, groupStats, parseInput, quantile, standing, threshold } from "../src/analysis.mjs";
import { identity, registerIdentity, ambiguousIdentities } from "./identity.mjs";
const r = (id, value, extra = {}) => ({ athleteId: id, name: id, gender: "M", team: "測試國中", kind: "individual", value, year: 2023, age: 14, group: "國中男子", wind: 1, round: "預賽", ...extra });
test("one athlete carries one vote regardless of starts", () => {
	const pool = [r("a", 12), r("a", 11), r("b", 13)];
	assert.deepEqual(
		bestPerAthlete(pool).map(r => r.value),
		[11, 13]
	);
	assert.deepEqual(
		bestPerAthlete(pool, false).map(r => r.value),
		[12, 13]
	);
});
test("time and distance ranking directions, ties, and out-of-range marks", () => {
	const pool = [r("a", 10), r("b", 11), r("c", 11), r("d", 12)];
	assert.equal(standing(pool, 11).topPercent, 50);
	assert.equal(standing(pool, 11, false).topPercent, 50);
	assert.equal(standing(pool, 15).topPercent, 100);
	assert.equal(standing([], 12), null);
	assert.equal(threshold(pool, 0), 10);
	assert.equal(threshold(pool, 0, false), 12);
});
test("unknown age and wind are excluded only by their explicit filters", () => {
	const pool = [r("a", 12), r("b", null), r("c", 11, { age: null, wind: null }), r("d", 10, { kind: "relay" }), r("e", 9, { wind: 2.1 })];
	const f = { gender: "M", group: "", from: 2020, to: 2026, age: "", wind: "all", round: "", team: "" };
	assert.equal(comparePool(pool, f).length, 3);
	assert.equal(comparePool(pool, { ...f, age: "14" }).length, 2);
	assert.equal(comparePool(pool, { ...f, wind: "legal" }).length, 1);
});
test("each age/year deduplicates an athlete independently", () => {
	const s = groupStats([r("a", 12), r("a", 11), r("b", 13), r("a", 10, { year: 2024 })], "year");
	assert.equal(s[0].n, 2);
	assert.equal(s[0].median, 12);
	assert.equal(s[1].best, 10);
});
test("formats long races without rounding seconds into invalid 60.xx", () => {
	assert.equal(formatResult(119.04), "1:59.04");
	assert.equal(formatResult(119.999), "2:00.00");
	assert.equal(formatResult(null), "—");
	assert.equal(quantile([], 0.5), null);
});
test("same name with conflicting birth years or unverified teams is kept separate", () => {
	const a = r("張小明", 11, { birthYear: 2008 }),
		b = r("張小明", 12, { birthYear: 2009 });
	assert.notEqual(identity(a).id, identity(b).id);
	assert.notEqual(identity({ ...a, birthYear: null }).id, identity({ ...a, birthYear: null, team: "另一國中" }).id);
	assert.equal(identity(a).id, identity({ ...a, team: "另一學校" }).id);
});
test("verified international aliases merge only with matching gender and birth year", () => {
	const chinese = r("林昱堂", 8, { birthYear: 2000 });
	assert.equal(identity(chinese).id, identity({ ...chinese, name: "YU TANG LIN" }).id);
	assert.notEqual(identity(chinese).id, identity({ ...chinese, name: "YU TANG LIN", birthYear: 1999 }).id);
	assert.ok(identity(chinese).evidence.length);
});
test("percentile inputs reject malformed times and non-time colons", () => {
	assert.equal(parseInput("1:59.04"), 119.04);
	assert.equal(parseInput("12.34"), 12.34);
	for (const s of ["1::2", "1:60", "12abc", "-1", "0", ""]) assert.equal(parseInput(s), null);
	assert.equal(parseInput("1:20", "m"), null);
});

test("same-meet conflicting bibs and teams split same-name same-year candidates", () => {
	const rs = new Map();
	const a = r("王小明", 12, { kind: "individual", meetId: "meet", birthYear: 2008, bib: "100", team: "學校甲" }),
		b = { ...a, bib: "200", team: "學校乙" };
	registerIdentity(rs, a);
	registerIdentity(rs, b);
	const conflicts = ambiguousIdentities(rs);
	assert.equal(conflicts.size, 1);
	assert.notEqual(identity(a, conflicts).id, identity(b, conflicts).id);
	assert.equal(identity(a, conflicts).basis, "name-gender-birth-team");
});
test("field age thresholds and yearly best retain higher-is-better direction", () => {
	const stats = groupStats([r("a", 6), r("a", 5.5), r("b", 7)], "age", false);
	assert.equal(stats[0].best, 7);
	assert.equal(stats[0].median, 6.5);
	assert.equal(stats[0].top10, 6.9);
});
