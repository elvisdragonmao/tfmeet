import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readdir, rm } from "node:fs/promises";
async function prune(dir: string): Promise<void> {
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const path = `${dir}/${entry.name}`;
		if (entry.isDirectory()) await prune(path);
		else if (entry.name.endsWith(".tmp") || (entry.name.endsWith(".json") && entry.name !== "manifest.json")) await rm(path);
	}
}
export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
		{
			name: "compressed-data-only",
			async closeBundle() {
				await prune("dist/data");
			}
		}
	],
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("echarts") || id.includes("zrender")) return "charts";
					if (id.includes("motion")) return "motion";
				}
			}
		}
	}
});
