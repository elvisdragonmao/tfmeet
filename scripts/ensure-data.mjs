import { access, mkdir, readFile, rename } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { spawnSync } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
const run = (script, args = []) => {
	const r = spawnSync(process.execPath, [script, ...args], { stdio: "inherit", env: { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=8192" } });
	if (r.status !== 0) process.exit(r.status || 1);
};
try {
	await access(new URL("../public/data/manifest.json", import.meta.url));
} catch {
	await mkdir(".cache", { recursive: true });
	await mkdir("public/data", { recursive: true });
	try {
		console.log("Downloading the published dataset snapshot…");
		const res = await fetch("https://github.com/elvisdragonmao/tfmeet/releases/download/dataset/tfmeet-data.tar.gz", { signal: AbortSignal.timeout(120000) });
		if (!res.ok || !res.body) throw new Error("Snapshot unavailable");
		await pipeline(Readable.fromWeb(res.body), createWriteStream(".cache/build-data.tar.gz.tmp"));
		await rename(".cache/build-data.tar.gz.tmp", ".cache/build-data.tar.gz");
		const extracted = spawnSync("tar", ["-xzf", ".cache/build-data.tar.gz", "-C", "public/data"], { stdio: "inherit" });
		if (extracted.status !== 0) throw new Error("Snapshot extraction failed");
	} catch {
		console.log("No usable snapshot is available; downloading all source competitions.");
		run("scripts/crawl.mjs");
		run("scripts/reparse.mjs");
		run("scripts/derive.mjs");
	}
}
let manifest = JSON.parse(await readFile(new URL("../public/data/manifest.json", import.meta.url)));
if (!manifest.events?.length) {
	run("scripts/derive.mjs");
	manifest = JSON.parse(await readFile(new URL("../public/data/manifest.json", import.meta.url)));
}
if (manifest.discovered !== manifest.meets.length) throw new Error("Incomplete competition inventory; refusing deployment");
