const fieldEvents = new Map(
	Object.entries({
		highjump: "跳高",
		polevault: "撐竿跳高",
		longjump: "跳遠",
		triplejump: "三級跳遠",
		shot: "鉛球",
		shotput: "鉛球",
		discus: "鐵餅",
		discusthrow: "鐵餅",
		hammer: "鏈球",
		hammerthrow: "鏈球",
		javelin: "標槍",
		javelinthrow: "標槍",
		combinedevents: "全能運動",
		decathlon: "十項全能",
		heptathlon: "七項全能",
		pentathlon: "五項全能",
		marathon: "馬拉松"
	})
);

const weights = {
	鉛球: { 國小: [2720, 2720], 國中: [5000, 3000], 高中: [6000, 4000], 成年: [7260, 4000] },
	鐵餅: { 國中: [1500, 1000], 高中: [1750, 1000], 成年: [2000, 1000] },
	標槍: { 國中: [700, 500], 高中: [800, 600], 成年: [800, 600] }
};

const hurdles = {
	"100M跨欄": { 國中: [null, 762], 高中: [null, 838], 成年: [null, 838] },
	"110M跨欄": { 國中: [914, null], 高中: [991, null], 成年: [1067, null] },
	"400M跨欄": { 國中: [838, 762], 高中: [914, 762], 成年: [914, 762] }
};

export const dataRulesVersion = 1;

function parseSpecification(family, details) {
	if (/跨欄|障礙/.test(family)) {
		const height = details.match(/(\d+(?:\.\d+)?)\s*(毫米|mm|公分|cm|公尺|m|英吋|英寸|in|吋|寸)(?=\s|$)/i);
		if (!height) return null;
		const [, number, unit] = height;
		const scale = /^(?:毫米|mm)$/i.test(unit) ? 1 : /^(?:公分|cm)$/i.test(unit) ? 10 : /^(?:公尺|m)$/i.test(unit) ? 1000 : 25.4;
		const mm = Math.round(Number(number) * scale);
		return mm === 990 && family === "110M跨欄" ? 991 : mm || null;
	}
	if (!/^(?:鉛球|鐵餅|標槍|鏈球)$/.test(family)) return null;
	const weight = details.match(/(\d+(?:\.\d+)?)\s*(公斤|kg|公克|克|g|lbs?|p|磅)(?=\s|$)/i);
	if (!weight) return null;
	const [, number, unit] = weight;
	if (/^(?:公斤|kg)$/i.test(unit)) return Math.round(Number(number) * 1000);
	if (/^(?:公克|克|g)$/i.test(unit)) return Math.round(Number(number));
	if (Number(number) === 6) return 2720;
	if (Number(number) === 16) return 7260;
	return Math.round(Number(number) * 453.59237);
}

export function normalizeEvent(source) {
	const labels = source.normalize("NFKC").split(/[；;]/);
	const label = (labels.findLast(part => /\p{Script=Han}/u.test(part)) || labels.at(-1)).trim();
	const base = label.replace(/\([^)]*\)/g, "").replace(/\s+/g, "");
	const key = base.toLowerCase().replace(/-/g, "");
	const translated = fieldEvents.get(key);
	let family =
		translated ||
		base
			.replace(/(\d)(?:met(?:er|re)s?|公尺|m)(?=$|[^a-z]|h(?:urdles?)?$|sc$|steeplechase$|walk$|racewalk$|relay$)/gi, "$1M")
			.replace(/(?<=\dM)(?:hurdles?|h)$/i, "跨欄")
			.replace(/(?<=\dM)(?:steeplechase|sc)$/i, "障礙")
			.replace(/(?<=\dM)(?:racewalk|walk)$/i, "競走")
			.replace(/(?<=\dM)relay$/i, "接力")
			.replace(/(?<=\d)[xX*＊](?=\d)/g, "×")
			.replace(/接$/, "接力")
			.replace(/^(\d+(?:\.\d+)?)公里(?=競走$)/, (_, km) => `${Math.round(Number(km) * 1000)}M`);
	if (family === "400M接力") family = "4×100M接力";
	if (family === "800M接力") family = "4×200M接力";
	if (family === "1600M接力") family = "4×400M接力";
	if (/^(?:混合4×400M|4×400M混合)接力$/.test(family)) family = "4×400M混合接力";
	if (family === "壘球") family = "壘球擲遠";
	if (family === "混合運動") family = "全能運動";
	const specification = parseSpecification(family, [...label.matchAll(/\(([^)]*)\)/g)].map(match => match[1]).join(" "));
	const unit = /全能/.test(family) ? "points" : /^(?:\d+[×])?\d+(?:\.\d+)?M|接力|馬拉松/.test(family) ? "s" : "m";
	return { family, specification, unit };
}

export function normalizeGroup(group, gender) {
	const raw = group.normalize("NFKC").replace(/\s/g, "").replace(/組$/, "");
	const category = raw.replace(/全能|三項|混合接力|混合/g, "");
	const sex = gender === "M" ? "男子" : gender === "F" ? "女子" : gender === "X" ? "混合" : "";
	if (/國小|小學|[男女]童|^小[男女]|^[男女]生[甲乙]?$/.test(category)) return `國小${sex}`;
	if (/國中|初中|^國[男女]/.test(category)) return `國中${sex}`;
	if (/高中|高職|^高[男女]/.test(category)) return `高中${sex}`;
	if (/成年|成人/.test(category)) return `成年${sex}`;
	const college = category.match(/^(?:大專|大學)(?:[男女](?:生|子)?)?([甲乙])?$/);
	if (college) return `大專${sex}${college[1] || ""}`;
	const ageGroup = category.match(/^U(\d+)(?:[男女](?:生|子)?)?$/i);
	if (ageGroup) return `U${ageGroup[1]}${sex}`;
	const open = category.match(/^(公開|一般)?[男女](?:生|子)?$/);
	if (open) return `${open[1] || ""}${sex}`;
	return raw;
}

export function inferSpecification(family, group, gender, age) {
	const standards = weights[family] || hurdles[family];
	if (!standards || !["M", "F"].includes(gender) || /長青|壯年|樂齡|Masters/i.test(group)) return null;
	const category = group.match(/^(國小|國中|高中|成年|大專)/)?.[0];
	const level = category === "大專" ? "成年" : category || (age >= 5 && age <= 12 ? "國小" : age >= 13 && age <= 15 ? "國中" : age >= 16 && age <= 18 ? "高中" : age >= 19 ? "成年" : null);
	return standards[level]?.[gender === "M" ? 0 : 1] ?? null;
}

export function specificationLabel(family, size) {
	if (/跨欄|障礙/.test(family)) return `${size} mm`;
	if (family === "標槍") return `${size} g`;
	if (size === 2720) return "2.72 kg（6 磅）";
	if (size === 7260) return "7.26 kg（16 磅）";
	return `${size / 1000} kg`;
}
