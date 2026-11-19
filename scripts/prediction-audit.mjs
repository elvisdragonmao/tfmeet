import { writeFile } from "node:fs/promises";
import { dataDistribution, groupBy, loadPredictionData, snapshotRoot, throwingEvents } from "./prediction-data.mjs";

const reports = new URL("../reports/", import.meta.url);
const countPeople = rows => new Set(rows.map(r => r.athlete)).size;
const formatted = n => n.toLocaleString("en-US");
const markdown = (headers, rows) => [headers, headers.map(() => "---"), ...rows].map(row => `| ${row.join(" | ")} |`).join("\n");

export async function writeQualityReport(dataset) {
	const { manifest, events, fingerprint, identityBases } = dataset;
	const distribution = [];
	const rows = [];
	const pairs = [];
	for (const event of events) {
		const { name, gender, unit, counts: c, records, weight } = event;
		const { age, joint } = event.pairs;
		rows.push([
			name,
			gender,
			unit,
			c.rows,
			c.individual,
			c.validUnique,
			c.invalidMark,
			c.malformedMark + c.dubiousScale,
			c.missingDate,
			c.missingAge,
			c.statedSpec,
			c.inferredSpec,
			c.missingSpec,
			c.excludedIdentity,
			c.duplicates,
			c.usable,
			c.ranksOverEight
		]);
		for (const row of dataDistribution(records)) distribution.push([name, gender, unit, row.mass ?? "", row.age ?? "", row.n, row.athletes, row.p10, row.median, row.p90]);
		if (throwingEvents.has(name)) {
			for (const [transition, samples] of groupBy(weight, p => `${p.start.mass} → ${p.end.mass}`)) {
				const ages = samples.map(p => p.start.age);
				const gaps = samples.map(p => p.days);
				pairs.push([name, gender, transition, samples.length, countPeople(samples), Math.min(...ages), Math.max(...ages), Math.min(...gaps), Math.max(...gaps)]);
			}
		}
		event.summary = { age: age.length, ageAthletes: countPeople(age), joint: joint.length, jointAthletes: countPeople(joint) };
	}
	const quality = `# 歷史田徑成績資料品質

快照來源更新於 ${manifest.updatedAt}，分析索引生成於 ${manifest.derivedAt}。原始快照有 ${formatted(manifest.meets.length)} 場賽事、${formatted(manifest.recordCount)} 筆紀錄，涵蓋 ${Math.min(...manifest.meets.map(m => m.year))}–${Math.max(...manifest.meets.map(m => m.year))}。有 ${manifest.partial} 場標記缺漏、${manifest.restricted ?? 0} 場使用受限的替代成績來源。模型輸入索引 SHA-256 為 \`${fingerprint}\`。

## 結構與證據

- 專案使用靜態 JSON，沒有關聯式資料庫。\`meets/*.json.gz\` 保留來源頁、原始成績與表格。\`events/*.json.gz\` 依項目與性別存放標準化的 \`athleteId\`、來源成績字串 \`performance\`、計算值 \`value\`、比賽日期 \`date\`、出生年 \`birthYear\`、性別、組別和器材 \`specification\`。\`athletes.json.gz\` 提供身分分類，並有依 ID 分片的歷史索引。
- 選手 ID 是正規化姓名等欄位推導的候選識別碼，會隨身分規則更新；資料沒有田協跨賽事的永久唯一 ID。此分析排除缺出生年的姓名組合與同場有衝突而拆分的報名身分。不同身分分類的人數如下。
- 來源提供比賽日期與部分選手的出生年。當年年齡是比賽年份減出生年，足歲可能少一歲。缺出生年時保留未知，組別不代替年齡；任何模型支援的年齡也用當年年齡表達。
- 重量是來源項目名的公克數，欄高以毫米儲存。規格未知與推估規格皆排除。短跑等無器材規格的項目使用空規格。不直接比較不同重量、欄高或項目。
- 爬蟲抓各輪組次與替代逐組成績，資料含大量第 9 名以後成績（見表），也保留無效與未完成列。賽會涵蓋、項目有無、誰參賽及是否公開出生年仍會造成選樣偏差；只有跨年持續參賽者能形成縱向樣本。
- 排除非個人項目、非正有限成績、成績字串與數值不符、明顯量級異常及日期缺漏；依原始場次、組次、選手／號碼、成績和風速去重。各品質欄位可能重疊。量級檢查只能捕捉明顯問題，來源的手計時／電計時、歷史規則與環境條件仍可能有差異。

${markdown(["候選身分依據", "人數"], Object.entries(identityBases))}

[完整分布 CSV](prediction-distribution.csv) 依項目、性別、重量或欄高、當年年齡列出筆數、選手數與 P10／中位數／P90。分布採清理後的實際出賽，當年年齡空白代表未知。

## 各項資料品質

${markdown(["項目", "性別", "單位", "索引列", "個人列", "有效去重", "無效", "格式／量級異常", "日期缺漏", "年齡缺漏", "明載規格", "推估規格", "規格缺漏", "身分排除", "重複", "可用列", "名次 > 8"], rows)}

## 重量資料重疊

用同一選手、同一當年年齡、相隔不超過 90 日的不同重量找配對。每人每年每方向保留時間最接近的一對，數字是切分回測前的上限。空白的重量方向沒有符合條件的配對。

${markdown(["項目", "性別", "公克方向", "配對", "選手", "最小年齡", "最大年齡", "最短間隔日", "最長間隔日"], pairs)}

## 縱向資料

同一選手每年每規格取賽會日中位數作代表。同項目同規格為年齡單獨預測；跨規格另列，年齡與重量可能同時改變。以下為 1–3 年跨度、切分前的配對數。

${markdown(
	["項目", "性別", "同規格配對", "同規格選手", "跨規格配對", "跨規格選手"],
	events.map(({ name, gender, summary }) => [name, gender, summary.age, summary.ageAthletes, summary.joint, summary.jointAthletes])
)}
`;
	await writeFile(new URL("prediction-data.md", reports), quality);
	await writeFile(
		new URL("prediction-distribution.csv", reports),
		["event,gender,unit,specification,calendar_age,starts,athletes,p10,median,p90", ...distribution.map(row => row.join(","))].join("\n") + "\n"
	);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], "file:").href) {
	const dataset = await loadPredictionData(snapshotRoot);
	await writeQualityReport(dataset);
	console.log(`Audited ${dataset.events.length} event/gender groups from ${dataset.manifest.recordCount} snapshot rows.`);
}
