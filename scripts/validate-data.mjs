import { readFile, stat } from "node:fs/promises";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
const root = new URL("../public/data/", import.meta.url);
const m = JSON.parse(await readFile(new URL("manifest.json", root)));
assert.ok(m.discovered >= 153, "Competition discovery unexpectedly shrank");
assert.equal(m.meets.length, m.discovered, "Incomplete inventory");
assert.ok(m.events.length > 0);
let count = 0;
let sessions = 0;
for (const meta of m.meets) {
	const d = JSON.parse(gunzipSync(await readFile(new URL(`meets/${meta.id}.json.gz`, root))).toString());
	assert.equal(d.id, meta.id);
	assert.equal(d.records.length, meta.records);
	assert.equal(d.pages.length + d.errors.filter(e => e.item).length, d.sessionCount || 0, `Unaccounted sessions in ${d.id}`);
	const ids = new Set();
	for (const p of d.pages) {
		assert.equal(new URL(p.url).searchParams.get("ID"), d.id, "Cross-meet source");
		for (const part of p.parts || []) assert.equal(new URL(part.url).searchParams.get("ID"), d.id, "Cross-meet fallback part");
		assert.equal(
			p.tables.reduce((n, t) => n + t.rows.length, 0),
			p.recordCount,
			"Unparsed rows"
		);
		sessions++;
	}
	for (const r of d.records) {
		assert.equal(r.meetId, d.id);
		assert.ok(!ids.has(r.id));
		ids.add(r.id);
		assert.equal(new URL(r.source).searchParams.get("ID"), d.id);
		assert.ok(r.name);
		if (r.age !== null) assert.equal(r.age, r.year - r.birthYear);
		if (r.value !== null) assert.ok(r.value > 0 && Number.isFinite(r.value));
	}
	count += d.records.length;
}
assert.equal(count, m.recordCount);
const indexCount = m.events.reduce((n, e) => n + e.count, 0);
assert.equal(indexCount, count);
const relayLinks = new Map();
if (m.dataRulesVersion) {
	for (const event of m.events) {
		const data = JSON.parse(gunzipSync(await readFile(new URL(`events/${event.id}.json.gz`, root))));
		assert.equal(data.name, event.name);
		assert.equal(data.gender, event.gender);
		assert.equal(data.kind, event.kind);
		assert.equal(data.records.length, event.count);
		const sizes = new Map(event.specifications.map(spec => [spec.size, { count: 0, valid: 0 }]));
		let valid = 0;
		for (const r of data.records) {
			assert.equal(r.event, event.name);
			assert.equal(r.gender, event.gender);
			const comparable = r.kind === (event.kind || "individual") && r.value !== null;
			if (comparable) valid++;
			if (event.kind === "relay") {
				assert.equal(r.kind, "relay");
				assert.equal(r.athleteId, "", "A relay event row must describe a team");
				assert.equal(r.age, null);
				for (const id of new Set(r.relayMembers?.flatMap(member => (member.athleteId ? [member.athleteId] : [])))) {
					relayLinks.set(`${id}:${r.id}`, [r.team, r.event, r.gender, r.value]);
				}
			}
			if (r.specification !== undefined) {
				const size = sizes.get(r.specification);
				assert.ok(size, `Missing specification ${r.specification} in ${event.name}`);
				size.count++;
				if (comparable) size.valid++;
			}
		}
		assert.equal(valid, event.valid);
		for (const { size, count, valid } of event.specifications) assert.deepEqual(sizes.get(size), { count, valid });
	}
}
if (m.athleteRedirects) {
	const athletes = JSON.parse(gunzipSync(await readFile(new URL("athletes.json.gz", root))));
	const ids = new Set(athletes.map(athlete => athlete.id));
	for (const [previous, canonical] of Object.entries(m.athleteRedirects)) {
		assert.ok(!ids.has(previous), `Redirect would hide an active athlete ${previous}`);
		assert.ok(ids.has(canonical), `Missing redirect target ${canonical}`);
	}
	if (m.events.some(event => event.kind === "relay")) {
		assert.ok(relayLinks.size > 0, "No teams linked to athlete histories");
		for (const prefix of new Set(athletes.map(a => a.id.slice(0, 2)))) {
			const bucket = JSON.parse(gunzipSync(await readFile(new URL(`athletes/${prefix}.json.gz`, root))));
			for (const [id, records] of Object.entries(bucket)) {
				for (const row of records.filter(r => r.kind === "relay")) {
					const key = `${id}:${row.id}`;
					assert.equal(row.athleteId, id);
					assert.ok(ids.has(id), "Linked athlete is missing from the index");
					assert.deepEqual([row.team, row.event, row.gender, row.value], relayLinks.get(key), "Relay history must match its team result");
					relayLinks.delete(key);
				}
			}
		}
		assert.equal(relayLinks.size, 0, "Missing relay results in athlete histories");
	}
}
await stat(new URL("archive.json.gz", root));
console.log(`Data verified: ${m.meets.length} competitions, ${sessions} source sessions, ${count} records; ${m.partial} competitions with disclosed gaps.`);

try {
	const previous = JSON.parse(await readFile(new URL("../.cache/previous-manifest.json", import.meta.url)));
	assert.ok(m.recordCount >= previous.recordCount * 0.9, "More than 10% of previous records disappeared; keep the existing deployment and investigate");
	assert.ok(m.discovered >= previous.discovered, "Competition inventory shrank");
	for (const before of previous.meets) {
		const now = m.meets.find(x => x.id === before.id);
		assert.ok(now && now.records >= before.records * 0.9, `Records disappeared in ${before.name || before.id}`);
	}
} catch (e) {
	if (e.code !== "ENOENT") throw e;
}
