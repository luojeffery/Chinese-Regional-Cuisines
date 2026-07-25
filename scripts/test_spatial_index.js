const assert = require("assert");
const {
  buildSpatialIndex,
  querySpatialIndex,
} = require("../assets/spatial_index.js");

const features = [
  { id: "small", bbox: [0, 0, 50, 50] },
  { id: "wide", bbox: [40, 40, 180, 120] },
  { id: "far", bbox: [500, 500, 540, 540] },
];

const index = buildSpatialIndex(features, 100);

assert.deepStrictEqual(
  querySpatialIndex(index, 25, 25).map((feature) => feature.id),
  ["small", "wide"],
);

assert.deepStrictEqual(
  querySpatialIndex(index, 510, 510).map((feature) => feature.id),
  ["far"],
);

assert.deepStrictEqual(querySpatialIndex(index, 300, 300), []);
