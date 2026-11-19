import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { normalizeEvent } from "../src/events.mjs";
import { predictPerformance } from "../src/prediction.mjs";
import { annualHistory, cleanEvent, snapshotRoot, summarizeDates } from "./prediction-data.mjs";

const argument = process.argv[2];
if (argument === "--help") {
	console.log("pnpm run prediction:predict [input.json]");
	console.log("Omit the file to provide a JSON request on stdin.");
	process.exit(0);
}
let json = "";
if (argument) json = await readFile(argument, "utf8");
else for await (const chunk of process.stdin.setEncoding("utf8")) json += chunk;
const input = JSON.parse(json);
const artifact = JSON.parse(await readFile(new URL("../public/prediction-model.json", import.meta.url)));
const initial = predictPerformance(artifact, input);

if (initial.status === "ok" && initial.model === "personal" && input.history === undefined && input.athleteId && Number.isInteger(input.currentYear)) {
	if (!/^[a-f0-9]{20}$/.test(input.athleteId)) throw new Error("Invalid athlete ID.");
	const event = normalizeEvent(input.event).family;
	const readGzip = async path => JSON.parse(gunzipSync(await readFile(new URL(path, snapshotRoot))));
	const athlete = (await readGzip("athletes.json.gz")).find(row => row.id === input.athleteId);
	if (athlete) {
		const shard = await readGzip(`athletes/${input.athleteId.slice(0, 2)}.json.gz`);
		const rows = (shard[input.athleteId] || []).filter(row => row.event === event && row.gender === input.gender && row.year < input.currentYear);
		const { records } = cleanEvent({ name: event, unit: initial.unit, records: rows }, new Map([[input.athleteId, athlete]]));
		input.history = annualHistory(summarizeDates(records), false, initial.unit === "s").map(row => ({
			athleteId: input.athleteId,
			event,
			gender: input.gender,
			age: row.age,
			year: row.year,
			mark: row.value,
			...(/跨欄|障礙/.test(event) ? { specificationMm: row.mass } : { weightKg: row.mass === null ? undefined : row.mass / 1000 })
		}));
	}
}
console.log(JSON.stringify(input?.history === undefined ? initial : predictPerformance(artifact, input), null, 2));
