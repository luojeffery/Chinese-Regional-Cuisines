(function attachEditorState(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  root.RegionEditorState = api;
})(typeof window !== "undefined" ? window : globalThis, function createEditorStateApi() {
  let regionColors = {};

  function setRegionColors(colors) {
    regionColors = colors && typeof colors === "object" ? { ...colors } : {};
  }

  function fillForRegion(region, fill) {
    return regionColors[region] || fill;
  }

  function normalizeRegionSearch(value) {
    return String(value ?? "")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function addSearchTerms(region, values) {
    for (const value of values) {
      const spaced = normalizeRegionSearch(value);
      const compact = spaced.replace(/\s+/g, "");
      if (spaced) region.searchTerms.add(spaced);
      if (compact && compact !== spaced) region.searchTerms.add(compact);
    }
  }

  function createCatalogRegion(name, fill) {
    const region = { name, fill, count: 0, searchTerms: new Set() };
    addSearchTerms(region, [name]);
    return region;
  }

  function buildRegionCatalog(countyFeatures) {
    const regions = new Map();
    for (const [name, fill] of Object.entries(regionColors)) {
      regions.set(name, createCatalogRegion(name, fill));
    }
    for (const feature of countyFeatures) {
      const props = feature.properties;
      if (!regions.has(props.region)) {
        regions.set(props.region, createCatalogRegion(props.region, fillForRegion(props.region, props.fill)));
      }
      const region = regions.get(props.region);
      region.count += 1;
      addSearchTerms(region, [
        props.GID_2,
        props.GID_3,
        props.NAME_1,
        props.NAME_2,
        props.NAME_3,
        props.NL_NAME_2,
        props.NL_NAME_3,
      ]);
    }
    return [...regions.values()]
      .map((region) => ({
        name: region.name,
        fill: region.fill,
        count: region.count,
        searchText: [...region.searchTerms].sort().join(" "),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function matchesRegionCatalogItem(region, filter) {
    const normalized = normalizeRegionSearch(filter);
    if (!normalized) return true;
    return (region.searchText || normalizeRegionSearch(region.name)).includes(normalized);
  }

  function setCountyRegion(overrides, feature, region) {
    const fill = fillForRegion(region.name, region.fill);
    feature.properties.region = region.name;
    feature.properties.fill = fill;
    overrides[feature.properties.GID_3] = {
      region: region.name,
      fill,
    };
    return overrides;
  }

  function regionFromFeature(feature) {
    const props = feature.properties || {};
    return {
      name: props.region,
      fill: fillForRegion(props.region, props.fill),
    };
  }

  function applyStoredOverrides(countyFeatures, overrides) {
    for (const feature of countyFeatures) {
      const override = overrides[feature.properties.GID_3];
      if (!override) continue;
      feature.properties.region = override.region;
      feature.properties.fill = fillForRegion(override.region, override.fill);
    }
    return countyFeatures;
  }

  function serializeOverrides(overrides) {
    const ordered = {};
    for (const gid of Object.keys(overrides).sort()) {
      ordered[gid] = {
        fill: fillForRegion(overrides[gid].region, overrides[gid].fill),
        region: overrides[gid].region,
      };
    }
    return JSON.stringify(ordered, null, 2);
  }

  function parseOverrides(raw) {
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    const clean = {};
    for (const [gid, value] of Object.entries(parsed)) {
      if (!value || typeof value.region !== "string" || typeof value.fill !== "string") continue;
      clean[gid] = { region: value.region, fill: value.fill };
    }
    return clean;
  }

  return {
    applyStoredOverrides,
    buildRegionCatalog,
    fillForRegion,
    matchesRegionCatalogItem,
    normalizeRegionSearch,
    parseOverrides,
    regionFromFeature,
    serializeOverrides,
    setRegionColors,
    setCountyRegion,
  };
});
