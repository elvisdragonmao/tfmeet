import { readFile, stat, readdir } from "node:fs/promises";
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
