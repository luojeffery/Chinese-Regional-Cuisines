const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const media = JSON.parse(fs.readFileSync(path.join(root, "assets", "article_media.json"), "utf8"));
const mapData = JSON.parse(fs.readFileSync(path.join(root, "assets", "map_data.json"), "utf8"));
const mapJs = fs.readFileSync(path.join(root, "assets", "map.js"), "utf8");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const cantoneseFiles = fs.readdirSync(path.join(root, "assets", "images", "cantonese")).filter((name) => /^img\d+\.(jpg|png|webp)$/i.test(name));
const tibetFiles = fs.existsSync(path.join(root, "assets", "images", "the-tibetan-plateau"))
  ? fs.readdirSync(path.join(root, "assets", "images", "the-tibetan-plateau")).filter((name) => /^img\d+\.(jpg|png|webp)$/i.test(name))
  : [];
const staleFallbackRegions = [];

assert.strictEqual(media.Cantonese.images.length, 6, "Cantonese should expose all six article gallery images");
assert.strictEqual(cantoneseFiles.length, 6, "Cantonese folder should contain all six downloaded gallery images");
assert.strictEqual(
  Object.values(mapData.features).find((feature) => feature.name === "Cantonese").images.length,
  6,
  "Cantonese sidebar data should use the six individual article images",
);
assert.ok(media.Cantonese.images.every((image) => image.src.startsWith("assets/images/cantonese/")), "Cantonese images should be local files");
assert.ok(media.Cantonese.images.every((image) => image.caption), "Cantonese images should have captions");
assert.ok(media.She.images.length >= 1, "newer split regions should have article media outside map_data features");
assert.ok(media["Hong Kong"].images.length >= 1, "Hong Kong should have article media outside map_data features");
assert.ok(media["Straits Chinese"].images.length >= 1, "Straits Chinese should have article media outside map_data features");
assert.strictEqual(media["Yi Sichuan"].images.length, 3, "Yi Sichuan should expose its three article food photos");
assert.strictEqual(media["Nei Mongolia East"].images.length, 3, "Nei Mongolia East should expose Inner Mongolia food photos");
assert.strictEqual(media["Nei Mongolia West"].images.length, 3, "Nei Mongolia West should expose Inner Mongolia food photos");
assert.strictEqual(media["Fujian-Derived Taiwanese"].images.length, 3, "Fujian-derived Taiwanese should expose its three article food photos");
assert.strictEqual(media["Non-Fujianese Taiwanese"].images.length, 3, "Non-Fujianese Taiwanese should expose its three article food photos");
assert.strictEqual(media.Taiwan.images.length, 6, "Taiwan map region should combine both Taiwanese article sections");
assert.strictEqual(media["Han Xinjiang"].images.length, 3, "Han Xinjiang should expose its three article food photos");
assert.strictEqual(media["Uyghur Xinjiang"].images.length, 3, "Uyghur Xinjiang should expose its three article food photos");
assert.strictEqual(media.Xinjiang.images.length, 6, "Xinjiang map region should combine Han and Uyghur Xinjiang photos");
assert.deepStrictEqual(
  media.Xinjiang.images.map((image) => image.group),
  ["Han Xinjiang", "Han Xinjiang", "Han Xinjiang", "Uyghur Xinjiang", "Uyghur Xinjiang", "Uyghur Xinjiang"],
  "combined Xinjiang photos should keep Han/Uyghur gallery group headers",
);
assert.strictEqual(media["The Tibetan Plateau"].images.length, 4, "Tibetan Plateau should expose its four food photos");
assert.strictEqual(tibetFiles.length, 4, "Tibetan Plateau folder should contain four downloaded food photos");
assert.strictEqual(
  Object.values(mapData.features).find((feature) => feature.name === "The Tibetan Plateau").images.length,
  4,
  "Tibetan Plateau sidebar data should use the four individual article food photos",
);
assert.ok(
  media["The Tibetan Plateau"].images.every((image) => image.src.startsWith("assets/images/the-tibetan-plateau/")),
  "Tibetan Plateau images should be local files",
);
for (const region of staleFallbackRegions) {
  for (const feature of Object.values(mapData.features).filter((item) => item.name === region)) {
    assert.strictEqual(feature.images.length, 0, `${region} should not keep stale fallback or map images`);
  }
  const folder = path.join(root, "assets", "images", region.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""));
  const staleFiles = fs.existsSync(folder) ? fs.readdirSync(folder).filter((name) => /^img\d+\.(jpg|png|webp)$/i.test(name)) : [];
  assert.strictEqual(staleFiles.length, 0, `${region} should not keep downloaded stale/map image files`);
}
for (const [region, expectedCount] of Object.entries({
  "Yi Sichuan": 3,
  "Nei Mongolia East": 3,
  "Nei Mongolia West": 3,
  Taiwan: 6,
  Xinjiang: 6,
})) {
  for (const feature of Object.values(mapData.features).filter((item) => item.name === region)) {
    assert.strictEqual(feature.images.length, expectedCount, `${region} map feature should expose ${expectedCount} food photos`);
  }
}
assert.ok(
  Object.values(media)
    .flatMap((item) => item.images)
    .every((image) => !/location of|breakdown of|province in china/i.test(image.caption)),
  "map/location image captions should be excluded",
);
assert.ok(
  Object.values(media)
    .flatMap((item) => item.images)
    .every((image) => !/(^|[\s.])((top|bottom)\s+(left|middle|center|right)|(left|middle|center|right))([\s.]|$)/i.test(image.caption)),
  "image captions should not include gallery-position directions",
);
assert.ok(
  Object.values(media)
    .flatMap((item) => item.images)
    .every((image) => image.src.startsWith("assets/images/") && fs.existsSync(path.join(root, image.src))),
  "all extracted article images should be downloaded into assets/images",
);
assert.match(mapJs, /fetch\("assets\/article_media\.json\?v=/, "sidebar should load extracted article media");
assert.match(mapJs, /fetch\("assets\/map_data\.json\?v=/, "sidebar base data should be cache-busted after media cleanup");
assert.match(indexHtml, /Food writing and photos: Chinese Cooking Demystified/, "page should credit Chinese Cooking Demystified");
assert.match(indexHtml, /chinesecookingdemystified\.substack\.com\/p\/63-chinese-cuisines-the-complete/, "source credit should link to the original article");
