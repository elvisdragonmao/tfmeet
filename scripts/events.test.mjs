import assert from "node:assert/strict";
import test from "node:test";
import { inferSpecification, normalizeEvent, normalizeGroup, specificationLabel } from "../src/events.mjs";

test("track distances, bilingual labels, and field events share canonical names", () => {
	for (const name of ["100m", "100公尺", "100 Metres", "100 Meters；100公尺", "100M(1)"]) {
		assert.deepEqual(normalizeEvent(name), { family: "100M", specification: null, unit: "s" });
	}
	assert.equal(normalizeEvent("800 Metres").family, "800M");
	assert.equal(normalizeEvent("3000mSC").family, "3000M障礙");
	assert.equal(normalizeEvent("4 x 100M Relay").family, "4×100M接力");
	assert.equal(normalizeEvent("Pole Vault(8)").family, "撐竿跳高");
	assert.equal(normalizeEvent("Combined Events").unit, "points");
});

test("race walks convert meters to kilometers without changing the timing unit", () => {
	for (const name of ["2000M競走", "2000 公尺競走", "2公里競走", "2km Race Walk", "2KM競走"]) {
		assert.deepEqual(normalizeEvent(name), { family: "2KM競走", specification: null, unit: "s" });
	}
	assert.equal(normalizeEvent("10000m Walk").family, "10KM競走");
	assert.equal(normalizeEvent("1500M競走").family, "1.5KM競走");
	assert.equal(normalizeEvent("2000M").family, "2000M");
});

test("equipment synonyms use the same metric size while distinct historical sizes survive", () => {
	assert.equal(normalizeEvent("110M跨欄(0.990m)").specification, 991);
	assert.equal(normalizeEvent("110 Meters Hurdles(39in)").specification, 991);
	assert.equal(normalizeEvent("100M跨欄(0.840m)").specification, 840);
	for (const unit of ["lbs", "lb", "p", "P", "磅"]) {
		assert.equal(normalizeEvent(`Shot Put(3)(6${unit})`).specification, 2720);
	}
	for (const name of ["鉛球(2.73kg)", "鉛球（2730 公克）", "鉛球 2.73 kg", "鉛球 2.72 kg（6 磅）"]) {
		assert.deepEqual(normalizeEvent(name), { family: "鉛球", specification: 2720, unit: "m" });
	}
	assert.equal(normalizeEvent("Discus Throw(7)(1.75公斤)").specification, 1750);
	assert.equal(normalizeEvent("Javelin Throw(500公克)").specification, 500);
	assert.equal(specificationLabel("鉛球", 2720), "2.72 kg（6 磅）");
	assert.equal(specificationLabel("鉛球", 7260), "7.26 kg（16 磅）");
});

test("school, sex, and age select the requested equipment standards", () => {
	for (const raw of ["高男", "高中男子", "高中男生組", "高男全能"]) assert.equal(normalizeGroup(raw, "M"), "高中男子");
	for (const raw of ["國小男子", "男生", "男童", "男童乙", "北市國小男子"]) assert.equal(normalizeGroup(raw, "M"), "國小男子");
	assert.equal(normalizeGroup("國女", "F"), "國中女子");
	assert.equal(normalizeGroup("小女三項", "F"), "國小女子");
	assert.equal(inferSpecification("110M跨欄", "高中男子", "M", 15), 991);
	assert.equal(inferSpecification("110M跨欄", "成年男子", "M", 18), 1067);
	assert.equal(inferSpecification("400M跨欄", "國中男子", "M", null), 838);
	assert.equal(inferSpecification("100M跨欄", "高中女子", "F", null), 838);
	assert.equal(inferSpecification("400M跨欄", "成年女子", "F", null), 762);
	assert.equal(inferSpecification("鉛球", "國小女子", "F", null), 2720);
	assert.equal(inferSpecification("鉛球", "公開男子", "M", 22), 7260);
	assert.equal(inferSpecification("鐵餅", "國中男子", "M", null), 1500);
	assert.equal(inferSpecification("標槍", "女子", "F", 14), 500);
	assert.equal(inferSpecification("標槍", "國小男子", "M", null), null);
	assert.equal(inferSpecification("鐵餅", "公開女子", "F", null), null);
	assert.equal(inferSpecification("鉛球", "大專男乙", "M", null), 7260);
	assert.equal(inferSpecification("110M跨欄", "亞青少男選拔", "M", null), 991);
	assert.equal(inferSpecification("鉛球", "U13男子", "M", 12), 2720);
	assert.equal(inferSpecification("鉛球", "U16女子", "F", null), null);
});

test("college, open and youth group aliases normalize for both genders", () => {
	for (const [gender, sex] of [
		["F", "女"],
		["M", "男"]
	]) {
		for (const raw of [`一般${sex}生`, `大專${sex}子`, `大專${sex}乙`]) assert.equal(normalizeGroup(raw, gender), `一般${sex}子`);
		for (const raw of [`公開${sex}子`, `大專${sex}甲`, `${sex}子`, `U19 ${sex}子`, `Ｕ２０ ${sex}生`, `U20選拔${sex}子`]) assert.equal(normalizeGroup(raw, gender), `公開${sex}子`);
		for (const raw of [`台日${sex}青`, `臺日青${sex}`, `亞青少${sex}`, `亞青少${sex}選拔`]) assert.equal(normalizeGroup(raw, gender), `高中${sex}子`);
		for (const limit of [13, 14, 15]) assert.equal(normalizeGroup(`U${limit} ${sex}生組`, gender), `國中${sex}子`);
		for (const limit of [16, 17, 18]) assert.equal(normalizeGroup(`U${limit}${sex}子`, gender), `高中${sex}子`);
		assert.equal(normalizeGroup(`U12${sex}子`, gender), `U12${sex}子`);
		assert.equal(normalizeGroup(`成年${sex}子`, gender), `成年${sex}子`);
	}
	assert.equal(normalizeGroup("大專乙混合", "X"), "大專混合乙");
	assert.equal(normalizeGroup("U15混合", "X"), "國中混合");
	assert.equal(normalizeGroup("Ｕ１８混合組", "X"), "高中混合");
});
