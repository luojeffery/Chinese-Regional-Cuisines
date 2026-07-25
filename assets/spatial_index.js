(function attachSpatialIndex(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.MapSpatialIndex = api;
})(typeof window !== "undefined" ? window : globalThis, function createSpatialIndexApi() {
  function cellKey(x, y) {
    return `${x},${y}`;
  }

  function buildSpatialIndex(features, cellSize = 96) {
    const cells = new Map();
    for (const feature of features) {
      const [x0, y0, x1, y1] = feature.bbox;
      const minX = Math.floor(x0 / cellSize);
      const maxX = Math.floor(x1 / cellSize);
      const minY = Math.floor(y0 / cellSize);
      const maxY = Math.floor(y1 / cellSize);
      for (let cy = minY; cy <= maxY; cy += 1) {
        for (let cx = minX; cx <= maxX; cx += 1) {
          const key = cellKey(cx, cy);
          if (!cells.has(key)) cells.set(key, []);
          cells.get(key).push(feature);
        }
      }
    }
    return { cellSize, cells };
  }

  function querySpatialIndex(index, x, y) {
    const cx = Math.floor(x / index.cellSize);
    const cy = Math.floor(y / index.cellSize);
    return index.cells.get(cellKey(cx, cy)) || [];
  }

  return {
    buildSpatialIndex,
    querySpatialIndex,
  };
});
