const assert = require("assert");
const regionColors = require("../assets/region_colors.json");
const {
  buildRegionCatalog,
  fillForRegion,
  matchesRegionCatalogItem,
  regionFromFeature,
  setRegionColors,
  setCountyRegion,
  applyStoredOverrides,
  serializeOverrides,
} = require("../assets/editor_state.js");

setRegionColors(regionColors);

const counties = [
  { properties: { GID_3: "A", region: "Xiang", fill: "#ff0000", NAME_3: "Shuangfeng" } },
  { properties: { GID_3: "B", region: "Hunan West", fill: "#00ff00", NAME_3: "Baojing" } },
  { properties: { GID_3: "C", region: "Xiang", fill: "#ff0000", NAME_3: "Hengshan" } },
  { properties: { GID_3: "D", region: "Upper River Gang", fill: "#f3ff8b", NAME_3: "Chengdu" } },
  {
    properties: {
      GID_2: "CHN.9.2_1",
      GID_3: "CHN.9.2.14_1",
      NAME_1: "Hainan",
      NAME_2: "Hainan",
      NAME_3: "Wanning",
      region: "Coastal (Qin-Lian-Lei-Qiong)",
      fill: "#78d2ff",
    },
  },
  {
    properties: {
      GID_2: "HKG.1_1",
      GID_3: "HKG.1_1",
      NAME_1: "HongKong",
      NAME_2: "CentralandWestern",
      NAME_3: "CentralandWestern",
      region: "Hong Kong",
      fill: "#00c884",
    },
  },
];

const catalog = buildRegionCatalog(counties);
function assertCatalogEntry(name, expected) {
  const actual = catalog.find((item) => item.name === name);
  assert.ok(actual, `Missing catalog entry for ${name}`);
  assert.strictEqual(actual.name, expected.name);
  assert.strictEqual(actual.fill, expected.fill);
  assert.strictEqual(actual.count, expected.count);
  assert.strictEqual(typeof actual.searchText, "string");
}

assertCatalogEntry("Hunan West", {
  name: "Hunan West",
  fill: "#ffdc17",
  count: 1,
});
assertCatalogEntry("Upper River Gang", {
  name: "Upper River Gang",
  fill: "#c25052",
  count: 1,
});
assertCatalogEntry("Xiang", {
  name: "Xiang",
  fill: "#ff0202",
  count: 2,
});
assertCatalogEntry("Xi River", {
  name: "Xi River",
  fill: "#bd52bc",
  count: 0,
});
assertCatalogEntry("She", {
  name: "She",
  fill: "#d8d8d8",
  count: 0,
});
assert.ok(catalog.find((item) => item.name === "Coastal (Qin-Lian-Lei-Qiong)").searchText.includes("wanning"));
assert.ok(catalog.find((item) => item.name === "Hong Kong").searchText.includes("hong kong"));
assert.ok(matchesRegionCatalogItem(catalog.find((item) => item.name === "Coastal (Qin-Lian-Lei-Qiong)"), "wanning"));
assert.ok(matchesRegionCatalogItem(catalog.find((item) => item.name === "Hong Kong"), "hong kong"));
assert.strictEqual(fillForRegion("Upper River Gang", "#f3ff8b"), "#c25052");
assert.deepStrictEqual(
  regionFromFeature({ properties: { region: "Pu’er-Sipsongpanna", fill: "#badbad" } }),
  { name: "Pu’er-Sipsongpanna", fill: "#ff519b" },
);

const overrides = {};
setCountyRegion(overrides, counties[0], catalog.find((item) => item.name === "Hunan West"));
assert.deepStrictEqual(overrides, {
  A: { region: "Hunan West", fill: "#ffdc17" },
});
assert.strictEqual(counties[0].properties.region, "Hunan West");
assert.strictEqual(counties[0].properties.fill, "#ffdc17");

applyStoredOverrides(counties, {
  B: { region: "Xiang", fill: "#ff0000" },
  D: { region: "Upper River Gang", fill: "#f3ff8b" },
});
assert.strictEqual(counties[1].properties.region, "Xiang");
assert.strictEqual(counties[1].properties.fill, "#ff0202");
assert.strictEqual(counties[3].properties.region, "Upper River Gang");
assert.strictEqual(counties[3].properties.fill, "#c25052");

assert.strictEqual(
  serializeOverrides({
    B: { fill: "#ff0000", region: "Xiang" },
    D: { fill: "#f3ff8b", region: "Upper River Gang" },
  }),
  '{\n  "B": {\n    "fill": "#ff0202",\n    "region": "Xiang"\n  },\n  "D": {\n    "fill": "#c25052",\n    "region": "Upper River Gang"\n  }\n}',
);
