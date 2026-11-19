import test from "node:test";
import assert from "node:assert/strict";
import { comparePool, groupStats } from "../src/analysis.mjs";
import { meetRegistrations, relayRoster, resolveRelayMember, suspectRelayTime } from "./relay.mjs";

test("relay rosters retain joined bibs and names without inventing birth years", () => {
	const record = text => ({ year: 2026, fields: { "選 手": text } });
	assert.deepEqual(relayRoster(record("1012 王小明 (2013)1031 Amy LIN (2012/2013) 1024 李小青 ()")), [
		{ bib: "1012", name: "王小明", birthYear: 2013 },
		{ bib: "1031", name: "Amy LIN", birthYear: null },
		{ bib: "1024", name: "李小青", birthYear: null }
	]);
	assert.deepEqual(relayRoster(record("1012王小明1031李小青")), [
		{ bib: "1012", name: "王小明", birthYear: null },
		{ bib: "1031", name: "李小青", birthYear: null }
	]);
	assert.deepEqual(relayRoster(record("")), []);
});

test("mixed relay members need corroboration and conflicting registrations stay apart", () => {
	const runner = { kind: "individual", bib: "1031", name: "王小明", birthYear: 2012, team: "臺北市", gender: "M" };
	const member = { bib: "01031", name: "王小明", birthYear: 2012 };
	const relay = { team: "台北市", gender: "X" };
	const lookup = (member, relay, ...rows) => resolveRelayMember(member, relay, meetRegistrations(rows), new Map(), new Map());
	assert.equal(lookup(member, relay, runner), runner);
	assert.equal(lookup(member, relay), null);
	assert.equal(lookup(member, relay, runner, { ...runner, gender: "F" }), null);
	assert.equal(lookup(member, { ...relay, gender: "M" }, { ...runner, birthYear: 2013 }), null);
	assert.equal(lookup({ ...member, birthYear: null }, { ...relay, gender: "M" }), null);
	assert.equal(lookup(member, { ...relay, gender: "M" }).birthYear, 2012);
});

test("relay distribution counts each team start and does not apply runner filters", () => {
	const a = { kind: "relay", athleteId: "", team: "甲隊", gender: "X", meetId: "m", item: "1", year: 2025, heat: "1", round: "預賽", value: 52, age: null, wind: null };
	const rows = [a, { ...a }, { ...a, team: "乙隊" }, { ...a, item: "2", round: "決賽", value: 51 }, { ...a, value: null }, { ...a, kind: "individual" }];
	const filters = { gender: "X", from: 2020, to: 2026, age: "15", wind: "legal" };
	const pool = comparePool(rows, filters, "relay");
	assert.equal(pool.length, 3);
	assert.equal(comparePool(rows, { ...filters, round: "決賽" }, "relay").length, 1);
	assert.equal(comparePool(rows, { ...filters, team: "甲隊" }, "relay").length, 2);
	assert.deepEqual(
		groupStats(pool, "year", true, true).map(({ n, median }) => [n, median]),
		[[3, 52]]
	);
});

test("outlying and malformed relay times remain identifiable as suspect", () => {
	assert.equal(suspectRelayTime("4×100M接力", "3:38.00", 218), true);
	assert.equal(suspectRelayTime("4×100M接力", "5:84.4", 384.4), true);
	assert.equal(suspectRelayTime("4×400M接力", "3:38.00", 218), false);
	assert.equal(suspectRelayTime("4×100M接力", "1:14.86", 74.86), false);
	assert.equal(suspectRelayTime("4×100M接力", "DQ", null), false);
});
