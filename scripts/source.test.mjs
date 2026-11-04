import test from "node:test";
import assert from "node:assert/strict";
import { decode, discover, numericResult, parseResults, rocDate, schedule, sourceURL } from "./source.mjs";
const meet = { id: "abc", url: "https://w3.athletics.org.tw/tfmeet/score_query_adv.php?ID=abc", year: 2023 };
const session = { item: "135", date: "2023-09-25", event: "100公尺", group: "國中男子", round: "預賽", url: "https://example.com/result" };
test("ROC and Gregorian dates remain distinct", () => {
	assert.equal(rocDate("099.11.05"), "2010-11-05");
	assert.equal(rocDate("1150308"), "2026-03-08");
	assert.equal(rocDate("2024.05.01"), "2024-05-01");
	assert.equal(rocDate(""), null);
});
test("non-finish and disqualified marks never become valid measurements", () => {
	for (const s of ["棄權(DNS)", "DNF", "違規(DQ) {11.80}", "NM", "取消"]) assert.equal(numericResult(s), null);
	assert.equal(numericResult("1:59.04"), 119.04);
	assert.equal(numericResult("6.43 (-0.9)"), 6.43);
	assert.equal(numericResult("0.00"), null);
});
test("discover all meets with category and correct calendar year", () => {
	const d = discover('<table><tr><th>全中運</th></tr><tr><td><a href="../tfmeet/score_query_adv.php?ID=abc">112年</a></td></tr></table>');
	assert.equal(d[0].category, "全中運");
	assert.equal(d[0].year, 2023);
});
test("schedule retains original equipment specification and all rounds", () => {
	const d = schedule(
		'<table><tr><td><a href="?action=score&item=12&ID=abc&grp_name=國中男子&su=預賽&g_date=112.09.25&peo=30">110公尺跨欄(0.914m)</a><a href="?action=score&mode=by_score&item=12&ID=abc">排序</a></td></tr></table>',
		meet
	);
	assert.equal(d.length, 1);
	assert.equal(d[0].event, "110公尺跨欄(0.914m)");
	assert.equal(d[0].date, "2023-09-25");
});
const track = `<table><thead><tr><th>組次</th><th></th><th>編號</th><th>選 手</th><th>單 位</th><th>成 績</th><th>晉級</th><th>風速</th></tr></thead><tbody><tr><td>1</td><td>1</td><td>4159</td><td>柳瀚珽 <span>2009</span><br><span>HAN-TING LIU</span></td><td>臺北市成淵高中<br><span>TPE</span></td><td><b>12.28</b></td><td>*</td><td>+1.6</td></tr><tr><td>1</td><td></td><td>4160</td><td>王小明 <span>2008</span></td><td>測試國中</td><td>違規(DQ)</td><td></td><td></td></tr></tbody></table>`;
test("track parsing extracts birth year without English name or country suffix", () => {
	const d = parseResults(track, session, meet);
	assert.equal(d.records.length, 2);
	assert.equal(d.records[0].name, "柳瀚珽");
	assert.equal(d.records[0].birthYear, 2009);
	assert.equal(d.records[0].age, 14);
	assert.equal(d.records[0].grade, null);
	assert.equal(d.records[0].team, "臺北市成淵高中");
	assert.equal(d.records[1].value, null);
	assert.equal(d.records[1].wind, 1.6);
});
test("bilingual international names enclosed in spans survive parsing", () => {
	const d = parseResults(
		"<table><tr><th>PLA名次</th><th>BIB編號</th><th>ATHLETE選手</th><th>TEAM單位</th><th>RESULTS成績</th></tr><tr><td>1</td><td>120</td><td><span>Sarah LAVIN</span><span><span>1994</span></span></td><td>IRL</td><td>13.36</td></tr></table>",
		session,
		meet
	);
	assert.equal(d.records[0].name, "Sarah LAVIN");
	assert.equal(d.records[0].birthYear, 1994);
});
test("field attempts are preserved and best mark is selected using expanded headers", () => {
	const h =
		'<table><thead><tr><th rowspan="2">名次</th><th rowspan="2">編號</th><th rowspan="2">選手</th><th rowspan="2">單位</th><th colspan="2">出賽成績</th><th rowspan="2">最佳成績</th></tr><tr><th>一</th><th>二</th></tr></thead><tbody><tr><td>1</td><td>5</td><td>陳勝佑<span>2008</span></td><td>臺南市新化國中</td><td>5.64(-1.6)</td><td>6.43(-0.9)</td><td>6.43 (-0.9)</td></tr></tbody></table>';
	const d = parseResults(h, { ...session, event: "跳遠" }, meet);
	assert.equal(d.records[0].value, 6.43);
	assert.equal(d.records[0].wind, -0.9);
	assert.equal(d.records[0].fields["出賽成績/一"], "5.64(-1.6)");
});
test("relay DNS entries without runner names remain in the full dump", () => {
	const h = "<table><tr><th>名次</th><th>編號</th><th>選手</th><th>單位</th><th>成績</th></tr><tr><td></td><td>T222</td><td></td><td>TPE</td><td>DNS</td></tr></table>";
	const d = parseResults(h, { ...session, event: "4×400公尺接力" }, meet);
	assert.equal(d.records.length, 1);
	assert.equal(d.records[0].kind, "relay");
	assert.equal(d.records[0].value, null);
	assert.equal(d.records[0].bib, "T222");
	assert.equal(d.records[0].nameProvided, false);
});
test("truncated relay labels never enter individual statistics", () => {
	const h = "<table><tr><th>名次</th><th>編號</th><th>選手</th><th>單位</th><th>成績</th></tr><tr><td>1</td><td>T1</td><td>甲乙丙丁</td><td>測試隊</td><td>42.00</td></tr></table>";
	assert.equal(parseResults(h, { ...session, event: "4×100公尺接" }, meet).records[0].kind, "relay");
});

test("source links retain legacy Big5 query encoding and modern UTF-8", () => {
	const old = sourceURL("https://w3.athletics.org.tw/tfmeet/score_query_adv.php?grp_name=男子&ID=abc");
	assert.ok(old.includes("grp_name=%a8k%a4l"));
	assert.equal(new URL(old).searchParams.get("ID"), "abc");
	assert.ok(sourceURL("https://w3.athletics.org.tw/tfmeet8/score_query_adv.php?grp_name=男子").includes("%E7%94%B7"));
});

test("a relay team is never assigned its first runner's birth year", () => {
	const result = parseResults(track, { ...session, event: "4×100公尺接力" }, meet).records[0];
	assert.equal(result.birthYear, null);
	assert.equal(result.age, null);
	assert.ok(result.fields["選 手"].includes("2009"));
});
test("alternate per-heat rank results retain wind and unique row identifiers", () => {
	const h = "<table><tr><th>名次</th><th>編號</th><th>選手</th><th>單位</th><th>成績</th></tr><tr><td>1</td><td>4160</td><td>沈郁森</td><td>新北新北高工A</td><td>14.82 (+0)</td></tr></table>";
	const a = parseResults(h, { ...session, heat: "1", event: "三級跳遠" }, meet).records[0],
		b = parseResults(h, { ...session, heat: "2", event: "三級跳遠" }, meet).records[0];
	assert.equal(a.value, 14.82);
	assert.equal(a.wind, 0);
	assert.equal(b.heat, "2");
	assert.notEqual(a.id, b.id);
});
test("English-only international field headers select RESULTS before POINT", () => {
	const h =
		"<table><thead><tr><th>PLA</th><th>BIB</th><th>ATHLETE</th><th>TEAM</th><th>LENGTH/1</th><th>RESULTS</th><th>POINT</th></tr></thead><tbody><tr><td>1</td><td>736</td><td>王鉦元<span>1996</span></td><td>中華台北</td><td>6.63</td><td>6.70 (-0.5)</td><td>743</td></tr></tbody></table>";
	const r = parseResults(h, { ...session, date: "2014-06-12", event: "跳遠(2)", group: "男子混合" }, meet).records[0];
	assert.equal(r.value, 6.7);
	assert.equal(r.gender, "M");
	assert.equal(r.kind, "combined-component");
	assert.equal(r.age, 18);
});
