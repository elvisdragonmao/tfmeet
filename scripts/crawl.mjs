import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { load } from "cheerio";
import { INDEX, clean, decode, discover, schedule, parseResults, sourceURL } from "./source.mjs";
const ROOT = new URL("../", import.meta.url);
const cache = new URL(".cache/html/", ROOT),
	output = new URL("public/data/meets/", ROOT);
await mkdir(cache, { recursive: true });
await mkdir(output, { recursive: true });
const args = process.argv.slice(2);
const refresh = args.includes("--refresh");
const limit = Number(args.find(a => a.startsWith("--limit="))?.split("=")[1] || 0);
const concurrency = Number(process.env.CRAWL_CONCURRENCY || 4);
const pause = ms => new Promise(r => setTimeout(r, ms));
let active = 0;
const pending = [];
async function limited(fn) {
	if (active >= concurrency) await new Promise(r => pending.push(r));
	active++;
	try {
		return await fn();
	} finally {
		active--;
		pending.shift()?.();
	}
}
let requests = 0,
	hits = 0;
let masterJar = { cookie: "" };
let expectedTitle = "";
async function get(url, { fresh = false, jar = masterJar } = {}) {
	const file = new URL(createHash("sha256").update(url).digest("hex") + ".html.gz", cache);
	if (!fresh && !refresh) {
		try {
			const body = gunzipSync(await readFile(file)).toString();
			if (expectedTitle && clean(load(body)("title").text()).replace(/-$/, "") !== expectedTitle) throw new Error("Stale cross-meet cache");
			hits++;
			return body;
		} catch {}
	}
	return limited(async () => {
		for (let attempt = 0; attempt < 4; attempt++) {
			try {
				await pause(180);
				const res = await fetch(sourceURL(url), {
					signal: AbortSignal.timeout(45000),
					headers: { Cookie: jar.cookie, "User-Agent": "TFMeetArchive/1.0 (+https://tfmeet.emtech.cc; public historical results; 4 concurrent requests max)" }
				});
				requests++;
				const setCookie = res.headers.getSetCookie().find(c => c.startsWith("PHPSESSID="));
				if (setCookie) jar.cookie = setCookie.split(";")[0];
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				const body = decode(Buffer.from(await res.arrayBuffer()));
				if (/Fatal error|Uncaught PDOException/i.test(body)) {
					const text = clean(load(body).text());
					const i = text.search(/Fatal error|Uncaught PDOException/);
					const e = new Error(text.slice(Math.max(0, i), Math.max(0, i) + 240));
					e.code = "SOURCE_FATAL";
					throw e;
				}
				if (/Too Many Requests|<title>[^<]*(?:403|502|503)/i.test(body)) throw new Error("Source temporarily unavailable");
				if (expectedTitle && clean(load(body)("title").text()).replace(/-$/, "") !== expectedTitle) throw new Error("Source returned a different competition title");
				if (!/<(?:html|table|body)/i.test(body)) throw new Error("Source returned no HTML document");
				await writeFile(file, gzipSync(body));
				return body;
			} catch (e) {
				if (attempt === 3 || e.code === "SOURCE_FATAL") throw e;
				await pause(1500 * 2 ** attempt);
			}
		}
	});
}
async function save(file, value) {
	const tmp = new URL(file.href + ".tmp");
	await writeFile(tmp, JSON.stringify(value));
	await rename(tmp, file);
}
const start = Date.now();
const indexHtml = await get(INDEX, { fresh: true });
let meets = discover(indexHtml).sort((a, b) => b.year - a.year || a.id.localeCompare(b.id));
if (!meets.length) throw new Error("No competitions discovered; refusing empty archive");
if (limit) meets = meets.slice(0, limit);
await writeFile(new URL("index.html.gz", cache), gzipSync(indexHtml));
console.log(`Discovered ${meets.length} competitions. Concurrency ${concurrency}.`);
const report = [];
let done = 0,
	sessionsDone = 0;
async function crawlMeet(meet) {
	const file = new URL(`${meet.id}.json`, output);
	let old;
	try {
		old = JSON.parse(await readFile(file, "utf8"));
	} catch {}
	// Fully parsed old meets can be reused on local resume, monthly CI refreshes all pages.
	if (old?.status === "complete" && !old.warnings?.length && !refresh) {
		report.push(oldSummary(old));
		done++;
		console.log(`[${done}/${meets.length}] cached ${old.name} (${old.records.length})`);
		return;
	}
	const errors = [];
	const warnings = [];
	const pages = [];
	const records = [];
	try {
		masterJar = { cookie: "" };
		expectedTitle = "";
		const html = await get(meet.url, { fresh: true });
		const $ = load(html);
		meet.name = clean($("title").text()).replace(/-$/, "");
		expectedTitle = meet.name;
		const menu = new URL(meet.url);
		menu.searchParams.set("ItNo", "21");
		menu.searchParams.set("htm", "2");
		menu.searchParams.set("action", "menu");
		menu.searchParams.set("mode", "1");
		menu.searchParams.set("sel_date", "all");
		const scheduleHtml = await get(menu.href);
		const sessions = schedule(scheduleHtml, meet);
		if (sessions.some(s => new URL(s.url).searchParams.get("ID") !== meet.id)) throw new Error("Schedule linked another competition; refusing cross-meet contamination");
		if (!sessions.length) throw new Error("No result sessions found in the all-dates schedule");
		console.log(`Starting ${meet.year} ${meet.name}: ${sessions.length} sessions`);

		let legacyMode = false,
			legacyMapPromise;
		async function parsedPage(context, jar) {
			const body = await get(context.url, { jar });
			const result = parseResults(body, context, meet);
			if (!result.records.length && context.expected > 0 && !/取消|尚無|尚未|未公布|無成績|停辦/.test(clean(load(body).text()))) throw new Error("No athlete rows parsed for a populated session");
			return result;
		}
		async function legacySession(s) {
			if (!legacyMapPromise) {
				const u = new URL(menu);
				u.pathname = u.pathname.replace("score_query_adv.php", "score_query.php");
				legacyMapPromise = get(u.href).then(body => new Map(schedule(body, meet).map(p => [p.item, p])));
			}
			const map = await legacyMapPromise;
			const item = map.get(s.item);
			if (!item || new URL(item.url).searchParams.get("ID") !== meet.id) throw new Error("Legacy schedule does not match the requested competition/session");
			return { ...s, url: item.url };
		}
		async function fetchSession(s, jar) {
			let primaryError;
			if (!legacyMode) {
				try {
					return { context: s, parsed: await parsedPage(s, jar) };
				} catch (e) {
					primaryError = e;
					if (e.code === "SOURCE_FATAL") legacyMode = true;
				}
			}
			if (!warnings.length) warnings.push({ code: "alternate-source", message: "新版成績頁故障，使用同站舊版／逐組成績頁取回全部選手成績；部分逐次試跳／試擲細節及出生年不可取得。", url: s.url });
			try {
				const context = await legacySession(s);
				return { context: { ...context, primaryUrl: s.url, variant: "legacy" }, parsed: await parsedPage(context, jar) };
			} catch {}
			const u = new URL(s.url),
				p = u.searchParams;
			const heats = Math.max(1, Number(p.get("tots") || 1));
			const parts = [],
				allRecords = [],
				allTables = [];
			for (let heat = 1; heat <= heats; heat++) {
				const rank = new URL("rank_stat.php", s.url);
				for (const key of ["ItNo", "ID", "item", "grp_num", "subno", "sub"]) if (p.has(key)) rank.searchParams.set(key, p.get(key));
				rank.searchParams.set("action", "score");
				rank.searchParams.set("tot", String(heat));
				rank.searchParams.set("su", p.get("su_no") || "4");
				const context = { ...s, url: rank.href, heat: String(heat) };
				const result = await parsedPage(context, jar);
				parts.push({ url: rank.href, heat: String(heat) });
				allRecords.push(...result.records);
				allTables.push(...result.tables);
				if (s.expected > 0 && allRecords.length >= s.expected) break;
			}
			if (s.expected > 0 && allRecords.length < s.expected) throw new Error(`Alternate results incomplete: ${allRecords.length}/${s.expected} rows`);
			return { context: { ...s, url: parts[0].url, primaryUrl: s.url, variant: "rank", detailLevel: "best-marks", parts }, parsed: { records: allRecords, tables: allTables } };
		}

		let cursor = 0;
		await Promise.all(
			Array.from({ length: Math.min(concurrency, sessions.length) }, async () => {
				const jar = { cookie: "" };
				await get(meet.url, { fresh: true, jar });
				while (cursor < sessions.length) {
					const s = sessions[cursor++];
					try {
						const { context, parsed } = await fetchSession(s, jar);
						pages.push({ ...context, recordCount: parsed.records.length, tables: parsed.tables });
						records.push(...parsed.records);
					} catch (e) {
						errors.push({ item: s.item, url: s.url, message: e.message });
					}
					sessionsDone++;
					if (sessionsDone % 100 === 0)
						console.log(`Progress: ${done}/${meets.length} meets, ${sessionsDone} sessions; ${requests} requests, ${hits} cached; ${Math.round((Date.now() - start) / 1000)}s elapsed`);
				}
			})
		);
		meet.sessionCount = sessions.length;
	} catch (e) {
		errors.push({ url: meet.url, message: e.message });
	}
	records.sort((a, b) => a.date?.localeCompare(b.date) || a.item.localeCompare(b.item) || a.id.localeCompare(b.id));
	const dump = { schemaVersion: 1, ...meet, fetchedAt: new Date().toISOString(), status: errors.length ? "partial" : "complete", errors, warnings, pages, records };
	await save(file, dump);
	await writeFile(new URL(`${meet.id}.json.gz`, output), gzipSync(JSON.stringify(dump)));
	report.push(oldSummary(dump));
	done++;
	console.log(`[${done}/${meets.length}] ${dump.status} ${meet.name || meet.id}: ${records.length} rows, ${errors.length} errors`);
	await save(new URL("public/data/crawl-progress.json", ROOT), { updatedAt: new Date().toISOString(), discovered: meets.length, done, sessionsDone, requests, hits, meets: report });
}
function oldSummary(d) {
	return {
		id: d.id,
		name: d.name,
		category: d.category,
		year: d.year,
		url: d.url,
		status: d.status,
		sessionCount: d.sessionCount || 0,
		pages: d.pages.length,
		records: d.records.length,
		errors: d.errors,
		warnings: d.warnings || [],
		fetchedAt: d.fetchedAt
	};
}
// One competition at a time keeps the load bounded and makes restart checkpoints useful.
for (const meet of meets) await crawlMeet(meet);
const manifest = {
	schemaVersion: 1,
	updatedAt: new Date().toISOString(),
	source: INDEX,
	discovered: meets.length,
	complete: report.filter(m => m.status === "complete").length,
	partial: report.filter(m => m.status !== "complete").length,
	recordCount: report.reduce((n, m) => n + m.records, 0),
	meets: report
};
await save(new URL("public/data/manifest.json", ROOT), manifest);
console.log(`Finished: ${manifest.complete} complete, ${manifest.partial} partial, ${manifest.recordCount} records.`);
// Parser/source failures must be visible to CI instead of silently publishing data loss.
if (!limit && manifest.recordCount === 0) throw new Error("No records; refusing to publish");
