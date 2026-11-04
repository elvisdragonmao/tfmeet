import { useState } from "react";
import { DownloadSimpleIcon } from "@phosphor-icons/react";
export default function DownloadFile({ href, children, className = "", filename }: { href: string; children: React.ReactNode; className?: string; filename?: string }) {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	async function download(e: React.MouseEvent<HTMLAnchorElement>) {
		e.preventDefault();
		if (busy) return;
		setBusy(true);
		setError("");
		try {
			const response = await fetch(href);
			if (!response.ok || !response.body) throw new Error("下載失敗，請重試");
			// Some static servers set Content-Encoding:gzip for .gz files and browsers
			// transparently decode them. Recompress only when the received stream is JSON.
			const reader = response.body.getReader();
			const first = await reader.read();
			const stream = new ReadableStream({
				start(c) {
					if (first.value) c.enqueue(first.value);
					if (first.done) c.close();
				},
				async pull(c) {
					const part = await reader.read();
					if (part.done) c.close();
					else c.enqueue(part.value);
				},
				cancel() {
					return reader.cancel();
				}
			});
			const compressed = first.value?.[0] === 31 && first.value?.[1] === 139;
			if (!compressed && first.value?.[0] !== 123 && first.value?.[0] !== 91) throw new Error("下載內容格式不正確，請稍後重試");
			const blob = await new Response(compressed ? stream : stream.pipeThrough(new CompressionStream("gzip"))).blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = filename || href.split("/").at(-1)?.split("?")[0] || "tfmeet.json.gz";
			a.click();
			setTimeout(() => URL.revokeObjectURL(url), 60000);
		} catch (e) {
			setError(e instanceof Error ? e.message : "下載失敗，請重試");
		} finally {
			setBusy(false);
		}
	}
	return (
		<span className="download-wrapper">
			<a href={href} download={filename || true} className={className} aria-busy={busy} onClick={download}>
				{busy ? <span className="loading loading-spinner loading-xs" /> : <DownloadSimpleIcon size={17} />}
				<span>{busy ? "準備下載…" : children}</span>
			</a>
			{error ? (
				<span className="download-error" role="alert">
					{error}
				</span>
			) : null}
		</span>
	);
}
