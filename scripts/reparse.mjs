import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { parseResults } from "./source.mjs";
const root = new URL("../", import.meta.url);
const files = (await readdir(new URL("public/data/meets/", root))).filter(f => f.endsWith(".json"));
let count = 0;
for (const file of files) {
	const path = new URL(`public/data/meets/${file}`, root);
	const meet = JSON.parse(await readFile(path, "utf8"));
	const records = [];
	for (const page of meet.pages) {
		let pageRecords = [],
			pageTables = [];
		const usedParts = [];
		for (const part of page.parts || [{ url: page.url }]) {
			const hash = createHash("sha256").update(part.url).digest("hex");
			const html = gunzipSync(await readFile(new URL(`.cache/html/${hash}.html.gz`, root))).toString();
			const parsed = parseResults(html, { ...page, ...part }, meet);
			pageRecords.push(...parsed.records);
			pageTables.push(...parsed.tables);
			usedParts.push(part);
			if (page.variant === "rank" && page.expected > 0 && pageRecords.length >= page.expected) break;
		}
		if (page.recordCount > 0 && !pageRecords.length) throw new Error(`Parser regression in ${meet.id}:${page.item}`);
		if (page.parts) page.parts = usedParts;
		page.recordCount = pageRecords.length;
		page.tables = pageTables;
		records.push(...pageRecords);
	}

	meet.records = records;
	meet.parserVersion = 2;
	const json = JSON.stringify(meet);
	await writeFile(path, json);
	await writeFile(new URL(path.href + ".gz"), gzipSync(json));
	count += records.length;
}
console.log(`Reparsed ${files.length} meets, ${count} rows from cached source HTML.`);
