import { mkdir, readFile, writeFile, readdir, rename, rm } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { createHash } from "node:crypto";
import { createGunzip, createGzip, gunzipSync, gzipSync } from "node:zlib";
import { once } from "node:events";
import { dataRulesVersion, normalizeEvent, normalizeGroup, inferSpecification } from "../src/events.mjs";
import { identity, registerIdentity, ambiguousIdentities, registerSourceAlias, sourceNameAlias } from "./identity.mjs";
const root = new URL("../public/data/", import.meta.url);
await mkdir(new URL("events/", root), { recursive: true });
await mkdir(new URL("athletes/", root), { recursive: true });
let manifest;
try {
	manifest = JSON.parse(await readFile(new URL("manifest.json", root), "utf8"));
} catch {
	const progress = JSON.parse(await readFile(new URL("crawl-progress.json", root), "utf8"));
	manifest = { schemaVersion: 1, source: "https://w3.athletics.org.tw/tfmeet/list_menu.php", updatedAt: progress.updatedAt, discovered: progress.discovered, meets: progress.meets };
}
try {
	const progress = JSON.parse(await readFile(new URL("crawl-progress.json", root), "utf8"));
	if (progress.meets.length > manifest.meets.length) manifest = { ...manifest, updatedAt: progress.updatedAt, meets: progress.meets };
} catch {}
const registrations = new Map();
const sourceAliases = new Map();
const meetPath = id => new URL(`meets/${id}.json.gz`, root);
const readMeet = async id => JSON.parse(gunzipSync(await readFile(meetPath(id))));
for (const meet of manifest.meets) {
	const d = await readMeet(meet.id);
	for (const r of d.records) {
		registerIdentity(registrations, r);
		registerSourceAlias(sourceAliases, r);
	}
}
const ambiguous = ambiguousIdentities(registrations);
registrations.clear();
const events = new Map(),
	athletes = new Map(),
	buckets = new Map();
const eventLabels = new Map();
const groupLabels = new Map();
let count = 0,
	withAge = 0;
for (const meet of manifest.meets) {
	let d;
	try {
		d = await readMeet(meet.id);
	} catch (e) {
		throw new Error(`Missing meet ${meet.id}: ${e.message}`);
	}
	meet.records = d.records.length;
	meet.category = (d.category ?? meet.category)?.trim() || "田徑";
	meet.pages = d.pages.length;
	meet.status = d.status;
	meet.errors = d.errors;
	meet.warnings = d.warnings || [];
	for (const r of d.records) {
		const ident = identity(r, ambiguous, sourceAliases);
		if (!eventLabels.has(r.event)) eventLabels.set(r.event, normalizeEvent(r.event));
		const { family: event, unit, specification: stated } = eventLabels.get(r.event);
		const groupKey = r.group + "|" + r.gender;
		if (!groupLabels.has(groupKey)) groupLabels.set(groupKey, normalizeGroup(r.group, r.gender));
		const group = groupLabels.get(groupKey);
		const specification = stated ?? inferSpecification(event, r.group, r.gender, r.age);
		const eventKey = event + "|" + r.gender;
		if (!events.has(eventKey))
			events.set(eventKey, {
				id: createHash("sha256").update(eventKey).digest("hex").slice(0, 16),
				name: event,
				gender: r.gender,
				unit,
				lowerIsBetter: unit === "s",
				records: [],
				sources: {}
			});
		const e = events.get(eventKey);
		const sessionKey = `${r.meetId}:${r.item}:${r.heat || ""}`;
		e.sources[sessionKey] = r.source;
		const { fields, source, ...record } = r;
		record.athleteId = ident.id;
		record.event = event;
		record.group = group;
		record.name = ident.displayName;
		record.kind = unit === "points" ? "combined" : /接力/.test(event) ? "relay" : r.kind;
		if (specification !== null) {
			record.specification = specification;
			if (stated === null) record.specificationInferred = true;
		}
		if (record.name !== r.name) record.originalName = r.name;
		e.records.push(record);
		count++;
		if (r.age !== null) withAge++;
		if (record.kind === "relay") continue;
		if (!athletes.has(ident.id))
			athletes.set(ident.id, {
				id: ident.id,
				name: ident.displayName,
				aliases: new Set(),
				evidence: ident.evidence,
				gender: r.gender,
				birthYear: r.birthYear,
				basis: ident.basis,
				teams: new Set(),
				events: new Set(),
				years: new Set(),
				count: 0
			});
		const a = athletes.get(ident.id);
		a.aliases.add(r.name);
		const alias = sourceNameAlias(r);
		if (alias) a.aliases.add(alias);
		if (ident.basis === "verified-source-alias" && !a.evidence.length) {
			a.basis = ident.basis;
			a.evidence = ident.evidence;
		}
		a.teams.add(r.team);
		a.events.add(event);
		a.years.add(r.year);
		a.count++;
		const bucket = ident.id.slice(0, 2);
		if (!buckets.has(bucket)) buckets.set(bucket, {});
		buckets.get(bucket)[ident.id] ??= [];
		buckets.get(bucket)[ident.id].push({ ...record, source: r.source });
	}
}
const eventIndex = [];
for (const e of events.values()) {
	const { id } = e;
	e.records.sort((a, b) => a.year - b.year || (a.value ?? Infinity) - (b.value ?? Infinity));
	const specifications = new Map();
	let valid = 0;
	for (const r of e.records) {
		const individual = r.value !== null && r.kind === "individual";
		if (individual) valid++;
		if (r.specification === undefined) continue;
		if (!specifications.has(r.specification)) specifications.set(r.specification, { size: r.specification, count: 0, valid: 0 });
		const spec = specifications.get(r.specification);
		spec.count++;
		if (individual) spec.valid++;
	}
	await writeFile(new URL(`events/${id}.json`, root), JSON.stringify(e));
	await writeFile(new URL(`events/${id}.json.gz`, root), gzipSync(JSON.stringify(e)));
	eventIndex.push({
		id,
		name: e.name,
		gender: e.gender,
		unit: e.unit,
		lowerIsBetter: e.lowerIsBetter,
		count: e.records.length,
		valid,
		specifications: [...specifications.values()].sort((a, b) => a.size - b.size),
		years: [...new Set(e.records.map(r => r.year))].sort()
	});
}
const eventIds = new Set(eventIndex.map(event => event.id));
for (const file of await readdir(new URL("events/", root))) {
	const id = file.replace(/\.json(?:\.gz)?$/, "");
	if (!eventIds.has(id)) await rm(new URL(`events/${file}`, root));
}
eventIndex.sort((a, b) => b.count - a.count);
const athleteIndex = [...athletes.values()].map(a => ({ ...a, aliases: [...a.aliases], teams: [...a.teams].sort(), events: [...a.events].sort(), years: [...a.years].sort() }));
athleteIndex.sort((a, b) => b.count - a.count);
await writeFile(new URL("athletes.json", root), JSON.stringify(athleteIndex));
await writeFile(new URL("athletes.json.gz", root), gzipSync(JSON.stringify(athleteIndex)));
for (const [bucket, data] of buckets) {
	await writeFile(new URL(`athletes/${bucket}.json`, root), JSON.stringify(data));
	await writeFile(new URL(`athletes/${bucket}.json.gz`, root), gzipSync(JSON.stringify(data)));
}
// A streamed JSON array avoids holding a second copy of the full archive in memory.
const archiveTemp = new URL("archive.json.gz.tmp", root);
const out = createWriteStream(archiveTemp);
const zip = createGzip({ level: 6 });
zip.pipe(out);
zip.write("[");
for (let i = 0; i < manifest.meets.length; i++) {
	if (i) zip.write(",");
	for await (const chunk of createReadStream(meetPath(manifest.meets[i].id)).pipe(createGunzip())) {
		if (!zip.write(chunk)) await once(zip, "drain");
	}
}
zip.end("]");
await once(out, "close");
await rename(archiveTemp, new URL("archive.json.gz", root));
manifest = {
	...manifest,
	dataRulesVersion,
	derivedAt: new Date().toISOString(),
	recordCount: count,
	athleteCount: athletes.size,
	identityConflicts: ambiguous.size,
	withAge,
	complete: manifest.meets.filter(m => m.status === "complete").length,
	partial: manifest.meets.filter(m => m.status !== "complete").length,
	restricted: manifest.meets.filter(m => m.warnings?.length > 0).length,
	events: eventIndex,
	archiveUrl: "archive.json.gz"
};
await writeFile(new URL("manifest.json", root), JSON.stringify(manifest));
console.log(`Derived ${count} records, ${events.size} event/gender files, ${athletes.size} athlete candidates; ${withAge} records have birth years.`);
