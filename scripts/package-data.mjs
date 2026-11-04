import { spawnSync } from "node:child_process";
import { readdir } from "node:fs/promises";
const files = [];
async function walk(dir = "") {
	for (const f of await readdir(`public/data/${dir}`, { withFileTypes: true })) {
		const path = dir + f.name;
		if (f.isDirectory()) await walk(path + "/");
		else if (path === "manifest.json" || path.endsWith(".json.gz")) files.push(path);
	}
}
await walk();
const r = spawnSync("tar", ["-czf", ".cache/tfmeet-data.tar.gz", "-C", "public/data", ...files], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status || 1);
console.log(`Packaged ${files.length} generated data files; no data enters Git.`);
