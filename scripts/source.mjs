import iconv from "iconv-lite";
import { load } from "cheerio";
export const ORIGIN = "https://w3.athletics.org.tw";
export const INDEX = `${ORIGIN}/tfmeet/list_menu.php?mode=by_expandV`;
export const clean = s => (s ?? "").replace(/[\s\u3000]+/g, " ").trim();
export const compact = s => clean(s).replace(/\s/g, "");
export function decode(buffer) {
	const head = buffer.subarray(0, 600).toString("ascii");
	return new TextDecoder(/utf-?8/i.test(head) ? "utf-8" : "big5").decode(buffer);
}
export function rocDate(s) {
	const m = s?.match(/^(\d{2,4})[.\-/]?(\d{2})[.\-/]?(\d{2})$/);
	if (!m) return null;
	let year = +m[1];
	if (year < 1911) year += 1911;
	return `${year}-${m[2]}-${m[3]}`;
}
export function discover(html) {
	const $ = load(html);
	const found = new Map();
	$('a[href*="score_query_adv.php?ID="]').each((_, el) => {
		const url = new URL($(el).attr("href"), INDEX);
		const id = url.searchParams.get("ID");
		const label = clean($(el).text());
		let year = Number(label.match(/\d+/)?.[0]);
		if (year < 1911) year += 1911;
		const row = $(el).closest("tr");
		const category = clean(
			row
				.prevAll("tr")
				.filter((_, r) => $(r).children("th").length > 0)
				.first()
				.text()
		);
		found.set(id, { id, url: url.href, year, category: category.replace(/\d+年[\s\S]*/, "").trim() });
	});
	return [...found.values()];
}
export function schedule(html, meet) {
	const $ = load(html);
	const sessions = new Map();
	$('a[href*="action=score"]').each((_, el) => {
		const a = $(el);
		const u = new URL(a.attr("href"), meet.url);
		if (u.searchParams.get("mode") || !u.searchParams.get("item")) return;
		const p = u.searchParams;
		const item = p.get("item");
		const cells = a.closest("tr").children("td");
		const context = {
			item,
			event: clean(a.text()),
			group: p.get("grp_name") || clean(cells.eq(2).text()),
			round: p.get("su") || clean(cells.eq(5).text()),
			date: rocDate(p.get("g_date")),
			expected: Number(p.get("peo") || 0)
		};
		// Pass source strings in their original Big5 encoding to avoid corrupting Chinese query values.
		const url = u.href;
		sessions.set(item, { ...context, url });
	});
	return [...sessions.values()];
}
// Expand multi-row headers; source uses colspan for attempts and rowspan for athlete fields.
export function tables(html) {
	const $ = load(html);
	const out = [];
	$("table").each((_, table) => {
		const rows = $(table)
			.find("tr")
			.filter((_, r) => $(r).closest("table")[0] === table)
			.toArray();
		const grid = [];
		const data = [];
		rows.forEach((r, ri) => {
			grid[ri] ??= [];
			let col = 0;
			const cells = $(r).children("th,td");
			cells.each((_, c) => {
				while (grid[ri][col] !== undefined) col++;
				const rs = Number($(c).attr("rowspan") || 1),
					cs = Number($(c).attr("colspan") || 1);
				for (let y = ri; y < ri + rs; y++) {
					grid[y] ??= [];
					for (let x = col; x < col + cs; x++) grid[y][x] = clean($(c).text());
				}
				col += cs;
			});
			if (cells.filter("th").length === 0 && cells.length > 2) data.push({ ri, cells: cells.toArray() });
		});
		const first = data[0]?.ri;
		if (first === undefined || first === 0) return;
		const headers = Array.from({ length: grid[first].length }, (_, i) =>
			[
				...new Set(
					grid
						.slice(0, first)
						.map(r => r[i])
						.filter(Boolean)
				)
			].join("/")
		);
		if (!headers.some(h => /選手|姓名|ATHLETE|NAME/i.test(compact(h))) || !headers.some(h => /成績|總分|RESULT|SCORE|MARK|POINT/i.test(compact(h)))) return;
		const parsed = data.map(({ ri, cells }) => ({ values: grid[ri], html: cells.map(c => $(c).html()) }));
		out.push({ headers, rows: parsed });
	});
	return out;
}
export function numericResult(text, event) {
	const s = clean(text);
	if (/DNS|DNF|DQ|NM|棄權|違規|失格|未完賽|無成績|取消/i.test(s)) return null;
	const m = s.match(/^\s*(\d+(?::\d+){0,2}(?:\.\d+)?)/);
	if (!m) return null;
	const parts = m[1].split(":").map(Number);
	const value = parts.reduce((a, n) => a * 60 + n, 0);
	if (!Number.isFinite(value) || value <= 0) return null;
	return Math.round(value * 1e6) / 1e6;
}
export function parseResults(html, session, meet) {
	const ts = tables(html);
	const records = [];
	for (const t of ts) {
		const idx = re => t.headers.findIndex(h => re.test(compact(h)));
		const ni = idx(/選手|姓名|ATHLETE|NAME/i),
			ti = idx(/單位|學校|TEAM|COUNTRY|NATION/i),
			bi = idx(/編號|號碼|BIB/i),
			ri = idx(/名次$|^PLA(?:CE)?$|^RANK$/i),
			hi = idx(/組次|HEAT/i),
			wi = idx(/風速|WIND/i);
		let vi = idx(/最佳成績|總成績|總分|BEST|TOTAL/i);
		if (vi < 0) vi = idx(/RESULT|SCORE|^成績$/i);
		if (vi < 0) vi = idx(/成績|MARK|POINT/i);
		const heatWinds = new Map();
		for (const row of t.rows) {
			const nameHtml = load(`<div>${row.html[ni] || ""}</div>`);
			const nameRoot = nameHtml("div");
			const spans = nameRoot
				.find("span")
				.toArray()
				.map(e => clean(nameHtml(e).text()));
			const relay = /接力|^[4４]\s*[×xX＊*]\s*\d+/.test(session.event);
			const birthYear = relay ? undefined : spans.map(s => s.match(/^(19|20)\d{2}$/)?.[0]).find(Boolean);
			nameRoot.find("span,br").remove();
			let name = clean(nameRoot.text()) || spans.find(s => s && !/^(19|20)\d{2}$/.test(s)) || "";
			const nameProvided = Boolean(name);
			const teamHtml = load(`<div>${row.html[ti] || ""}</div>`);
			teamHtml("span").remove();
			const team = clean(teamHtml("div").text());
			name ||= team || "未提供姓名";
			const raw = row.values[vi] || "";
			const age = birthYear && session.date ? Number(session.date.slice(0, 4)) - Number(birthYear) : null;
			const gender = /男/.test(session.group) && /女/.test(session.group) ? "X" : /女/.test(session.group) ? "F" : /男/.test(session.group) ? "M" : /混合/.test(session.group) ? "X" : "U";
			const windMatch = raw.match(/\(([+-]?\d+(?:\.\d+)?)\)/);
			let wind = wi >= 0 ? Number(row.values[wi]) : windMatch ? Number(windMatch[1]) : null;
			if (wi >= 0) {
				const heat = hi >= 0 ? row.values[hi] : "all";
				if (row.values[wi] && Number.isFinite(wind)) heatWinds.set(heat, wind);
				else wind = heatWinds.get(heat) ?? null;
			}
			const component = /全能/.test(session.group) || /^\d+\/\d+$/.test(session.round) || /\(\d+\)/.test(session.event);
			records.push({
				id: `${meet.id}:${session.item}:${session.heat || ""}:${records.length}`,
				meetId: meet.id,
				item: session.item,
				date: session.date,
				year: session.date ? +session.date.slice(0, 4) : meet.year,
				event: session.event,
				group: session.group,
				round: session.round,
				gender,
				name,
				nameProvided,
				team,
				bib: row.values[bi] || "",
				birthYear: birthYear ? +birthYear : null,
				age: age >= 5 && age <= 100 ? age : null,
				ageBasis: birthYear ? "calendar-year" : null,
				grade: null,
				kind: relay ? "relay" : component ? "combined-component" : /全能/.test(session.event) ? "combined" : "individual",
				performance: raw,
				value: /取消/.test(session.event) ? null : numericResult(raw, session.event),
				rank: ri >= 0 ? row.values[ri] : null,
				heat: hi >= 0 ? row.values[hi] : session.heat || null,
				wind,
				source: sourceURL(session.url),
				fields: Object.fromEntries(t.headers.map((h, i) => [h || `column${i}`, row.values[i] || ""]))
			});
		}
	}
	return { records, tables: ts.map(t => ({ headers: t.headers, rows: t.rows.map(r => r.values) })) };
}

export function sourceURL(url) {
	const u = new URL(url);
	if (u.pathname.startsWith("/tfmeet8/")) return u.href;
	const query = [...u.searchParams]
		.map(
			([k, v]) =>
				`${k}=${[...iconv.encode(v, "big5")].map(b => ((b >= 48 && b <= 57) || (b >= 65 && b <= 90) || (b >= 97 && b <= 122) || b === 45 || b === 46 || b === 95 ? String.fromCharCode(b) : `%${b.toString(16).padStart(2, "0")}`)).join("")}`
		)
		.join("&");
	return u.origin + u.pathname + "?" + query;
}
