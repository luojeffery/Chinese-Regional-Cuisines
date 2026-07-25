const canvas = document.getElementById("stage");
const ctx = canvas.getContext("2d");
const hoverLabel = document.getElementById("hoverLabel");
const labelLayer = document.getElementById("labelLayer");
const sidebar = document.getElementById("sidebar");
const sidebarInner = document.getElementById("sidebarInner");
const imageLightbox = document.getElementById("imageLightbox");
const imageLightboxImg = document.getElementById("imageLightboxImg");
const imageLightboxCaption = document.getElementById("imageLightboxCaption");
const imageLightboxClose = document.getElementById("imageLightboxClose");
const editorToggle = document.getElementById("editorToggle");
const editorPanel = document.getElementById("editorPanel");
const hideEditorPanelBtn = document.getElementById("hideEditorPanelBtn");
const activeRegionEl = document.getElementById("activeRegion");
const regionSearch = document.getElementById("regionSearch");
const regionList = document.getElementById("regionList");
const editStatus = document.getElementById("editStatus");
const correctionsOutput = document.getElementById("correctionsOutput");
const copyCorrectionsBtn = document.getElementById("copyCorrectionsBtn");
const undoCorrectionBtn = document.getElementById("undoCorrectionBtn");
const clearCorrectionsBtn = document.getElementById("clearCorrectionsBtn");
const refreshExportBtn = document.getElementById("refreshExportBtn");
const paintScopeButtons = document.querySelectorAll("[data-paint-scope]");

let mapData = null;
let regionGeo = null;
let regionColors = {};
let articleMedia = {};
let countyFeatures = [];
let prefectureFeatures = [];
let regionDetails = new Map();
const REGION_DISPLAY_NAMES = {
  "Lianzhou Yao": "Lianzhou (Yao)",
};
let labelEls = [];
let regionCatalog = [];
let activeRegion = null;
let regionOverrides = {};
let correctionHistory = [];
let editorOpen = false;
let editorPanelCollapsed = false;
let paintScope = "county";

const editorEnabled = false;
const editorStoreKey = "chineseRegionalCuisines.regionOverrides.v1";

const regionOutlineImg = new Image();
regionOutlineImg.src = "assets/region_outlines.png";

let dpr = Math.max(1, window.devicePixelRatio || 1);
let scale = 1;
let tx = 0;
let ty = 0;
let minScale = 0.2;
const maxScale = 12;
let bounds = null;
let hoverFeature = null;
let selectedFeature = null;
let flyRaf = null;
let spatialIndex = null;
let baseCanvas = null;
let baseCtx = null;
let baseDirty = true;
let hoverRaf = null;
let pendingHoverPoint = null;

function project(lon, lat) {
  const [sx, ox, sy, oy] = regionGeo.metadata.transform;
  return [lon * sx + ox, -lat * sy + oy];
}

function resizeCanvas() {
  dpr = Math.max(1, window.devicePixelRatio || 1);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  draw();
}

function includePoint(box, x, y) {
  box[0] = Math.min(box[0], x);
  box[1] = Math.min(box[1], y);
  box[2] = Math.max(box[2], x);
  box[3] = Math.max(box[3], y);
}

function pathFromGeometry(geometry) {
  const path = new Path2D();
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const lines = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    for (const line of lines) {
      line.forEach(([lon, lat], index) => {
        const [x, y] = project(lon, lat);
        includePoint(box, x, y);
        if (index === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      });
    }
    return { path, bbox: box };
  }
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ring.forEach(([lon, lat], index) => {
        const [x, y] = project(lon, lat);
        includePoint(box, x, y);
        if (index === 0) {
          path.moveTo(x, y);
        } else {
          path.lineTo(x, y);
        }
      });
      path.closePath();
    }
  }
  return { path, bbox: box };
}

function prepareFeature(feature, level) {
  const prepared = pathFromGeometry(feature.geometry);
  feature.path = prepared.path;
  feature.bbox = prepared.bbox;
  feature.level = level;
  return feature;
}

function computeBounds(features) {
  const box = [Infinity, Infinity, -Infinity, -Infinity];
  for (const feature of features) {
    includePoint(box, feature.bbox[0], feature.bbox[1]);
    includePoint(box, feature.bbox[2], feature.bbox[3]);
  }
  return box;
}

function computeFitTransform() {
  const sw = window.innerWidth;
  const sh = window.innerHeight;
  const bw = bounds[2] - bounds[0];
  const bh = bounds[3] - bounds[1];
  const pad = Math.min(sw, sh) * 0.04;
  const s = Math.min((sw - pad * 2) / bw, (sh - pad * 2) / bh);
  return {
    scale: s,
    tx: (sw - bw * s) / 2 - bounds[0] * s,
    ty: (sh - bh * s) / 2 - bounds[1] * s,
  };
}

function fitToScreen() {
  const t = computeFitTransform();
  scale = t.scale;
  tx = t.tx;
  ty = t.ty;
  minScale = t.scale;
}

function setWorldTransform() {
  ctx.setTransform(scale * dpr, 0, 0, scale * dpr, tx * dpr, ty * dpr);
}

function drawFeaturePath(targetCtx, feature, fill, stroke, lineWidth, currentScale = scale) {
  if (fill) {
    targetCtx.fillStyle = fill;
    targetCtx.fill(feature.path);
  }
  if (stroke && lineWidth > 0) {
    targetCtx.strokeStyle = stroke;
    targetCtx.lineWidth = lineWidth / currentScale;
    targetCtx.stroke(feature.path);
  }
}

function invalidateBaseLayer() {
  baseDirty = true;
}

function ensureBaseLayer() {
  if (!regionGeo || !baseDirty) return;
  const renderSize = regionGeo.metadata.render_size || [regionOutlineImg.naturalWidth || 2560, regionOutlineImg.naturalHeight || 2000];
  if (!baseCanvas || baseCanvas.width !== renderSize[0] || baseCanvas.height !== renderSize[1]) {
    baseCanvas = document.createElement("canvas");
    baseCanvas.width = renderSize[0];
    baseCanvas.height = renderSize[1];
    baseCtx = baseCanvas.getContext("2d");
  }

  baseCtx.setTransform(1, 0, 0, 1, 0, 0);
  baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
  baseCtx.lineJoin = "round";
  baseCtx.lineCap = "round";

  for (const feature of countyFeatures) {
    drawFeaturePath(baseCtx, feature, feature.properties.fill, "rgba(216,216,216,0.78)", 0.48, 1);
  }

  for (const feature of prefectureFeatures) {
    drawFeaturePath(baseCtx, feature, null, "rgba(82,82,82,0.9)", 0.92, 1);
  }

  baseCtx.drawImage(regionOutlineImg, 0, 0);
  baseDirty = false;
}

function draw() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f7f7f4";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!regionGeo) return;

  setWorldTransform();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  ensureBaseLayer();
  ctx.drawImage(baseCanvas, 0, 0);

  if (hoverFeature && hoverFeature !== selectedFeature) {
    drawFeaturePath(ctx, hoverFeature, "rgba(255,255,255,0.32)", "rgba(30,30,30,0.8)", 1.3);
  }
  if (selectedFeature) {
    drawFeaturePath(ctx, selectedFeature, "rgba(255,255,255,0.42)", "rgba(224,86,58,0.95)", 2.3);
  }

  updateLabelPositions();
  drawLabelLeaders();
}

function drawLabelLeaders() {
  const showLabels = scale >= minScale * 1.25;
  if (!showLabels) return;
  ctx.save();
  ctx.strokeStyle = "rgba(20,20,20,0.82)";
  ctx.lineWidth = 1 / scale;
  for (const item of labelEls) {
    if (!item.visible || !item.callout) continue;
    ctx.beginPath();
    ctx.moveTo(item.targetX, item.targetY);
    ctx.lineTo(item.x, item.y);
    ctx.stroke();
  }
  ctx.restore();
}

function updateLabelPositions() {
  const showLabels = scale >= minScale * 1.25;
  const placed = [];
  const sorted = [...labelEls].sort((a, b) => b.priority - a.priority);
  for (const item of sorted) {
    const sx = tx + item.x * scale;
    const sy = ty + item.y * scale;
    const w = Math.max(46, item.name.length * 7.2 + 12);
    const h = 20;
    const box = [sx - w / 2 - 3, sy - h / 2 - 3, sx + w / 2 + 3, sy + h / 2 + 3];
    const onScreen = box[2] >= -30 && box[0] <= window.innerWidth + 30 && box[3] >= -30 && box[1] <= window.innerHeight + 30;
    const collides = placed.some((other) => !(box[2] < other[0] || box[0] > other[2] || box[3] < other[1] || box[1] > other[3]));
    item.visible = showLabels && onScreen && (!collides || scale >= minScale * 3.4);
    item.screenX = sx;
    item.screenY = sy;
    if (item.visible) placed.push(box);
  }
  for (const item of labelEls) {
    item.el.style.display = item.visible ? "block" : "none";
    item.el.style.transform = `translate(${item.screenX}px, ${item.screenY}px) translate(-50%,-50%)`;
  }
}

function screenToWorld(clientX, clientY) {
  return {
    x: (clientX - tx) / scale,
    y: (clientY - ty) / scale,
  };
}

function bboxContains(feature, x, y) {
  const [x0, y0, x1, y1] = feature.bbox;
  return x0 <= x && x <= x1 && y0 <= y && y <= y1;
}

function featureAt(clientX, clientY) {
  if (!countyFeatures.length) return null;
  const point = screenToWorld(clientX, clientY);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const candidates = spatialIndex ? window.MapSpatialIndex.querySpatialIndex(spatialIndex, point.x, point.y) : countyFeatures;
  for (let i = candidates.length - 1; i >= 0; i--) {
    const feature = candidates[i];
    if (bboxContains(feature, point.x, point.y) && ctx.isPointInPath(feature.path, point.x, point.y)) {
      return feature;
    }
  }
  return null;
}

function updateHover(clientX, clientY) {
  const feature = featureAt(clientX, clientY);
  if (feature !== hoverFeature) {
    hoverFeature = feature;
    draw();
  }
  if (feature) {
    hoverLabel.textContent = `${feature.properties.region}: ${feature.properties.NAME_3}`;
    hoverLabel.style.display = "block";
    hoverLabel.style.left = `${clientX + 16}px`;
    hoverLabel.style.top = `${clientY + 12}px`;
  } else {
    hoverLabel.style.display = "none";
  }
}

function scheduleHover(clientX, clientY) {
  pendingHoverPoint = { clientX, clientY };
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = null;
    const point = pendingHoverPoint;
    pendingHoverPoint = null;
    if (point) updateHover(point.clientX, point.clientY);
  });
}

function animateTo(targetScale, targetTx, targetTy, duration) {
  if (flyRaf) cancelAnimationFrame(flyRaf);
  const startScale = scale;
  const startTx = tx;
  const startTy = ty;
  const startTime = performance.now();
  function step(now) {
    const t = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    scale = startScale + (targetScale - startScale) * eased;
    tx = startTx + (targetTx - startTx) * eased;
    ty = startTy + (targetTy - startTy) * eased;
    draw();
    flyRaf = t < 1 ? requestAnimationFrame(step) : null;
  }
  flyRaf = requestAnimationFrame(step);
}

function flyToBounds(box) {
  const [x0, y0, x1, y1] = box;
  const bw = Math.max(1, x1 - x0);
  const bh = Math.max(1, y1 - y0);
  const sidebarW = Math.min(420, window.innerWidth * 0.9);
  const availW = Math.max(260, window.innerWidth - sidebarW);
  const availH = window.innerHeight;
  const targetScale = Math.min(maxScale, Math.max(minScale, Math.min(availW / bw, availH / bh) * 0.58));
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  animateTo(targetScale, availW / 2 - cx * targetScale, availH / 2 - cy * targetScale, 560);
}

function flyToFeature(feature) {
  flyToBounds(feature.bbox);
}

function flyToRegion(regionName) {
  const stat = buildRegionStats().get(regionName);
  if (stat) {
    flyToBounds(stat.bbox);
  }
}

function zoomBy(factor) {
  if (flyRaf) cancelAnimationFrame(flyRaf);
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const p = screenToWorld(cx, cy);
  const targetScale = Math.min(maxScale, Math.max(minScale, scale * factor));
  animateTo(targetScale, cx - p.x * targetScale, cy - p.y * targetScale, 240);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function galleryClassForCount(count) {
  if (count === 6) return "imageGallery gallerySix";
  if (count === 4) return "imageGallery galleryFour";
  if (count === 3) return "imageGallery galleryThree";
  return "imageGallery";
}

function imageGroups(images) {
  const groups = [];
  for (let index = 0; index < images.length; index += 1) {
    const image = images[index];
    const name = image.group || "";
    const last = groups[groups.length - 1];
    if (!last || last.name !== name) {
      groups.push({ name, items: [] });
    }
    groups[groups.length - 1].items.push({ image, index });
  }
  return groups;
}

function loadStoredOverrides() {
  try {
    return window.RegionEditorState.parseOverrides(localStorage.getItem(editorStoreKey));
  } catch (error) {
    console.warn("Could not load saved region corrections", error);
    return {};
  }
}

function persistOverrides() {
  const serialized = window.RegionEditorState.serializeOverrides(regionOverrides);
  localStorage.setItem(editorStoreKey, serialized);
  correctionsOutput.value = serialized;
  editStatus.textContent = `${Object.keys(regionOverrides).length} county edit${Object.keys(regionOverrides).length === 1 ? "" : "s"} saved in this browser. Mode: ${paintScope}. Tell Codex when you are finished.`;
}

function renderActiveRegion() {
  const chip = activeRegionEl.querySelector(".swatchChip");
  const label = activeRegionEl.querySelector("span:last-child");
  if (!activeRegion) {
    chip.style.background = "transparent";
    label.textContent = "Select a region";
    return;
  }
  chip.style.background = activeRegion.fill;
  label.textContent = activeRegion.name;
}

function selectEditorRegion(regionName) {
  activeRegion = regionCatalog.find((region) => region.name === regionName) || regionCatalog[0] || null;
  renderActiveRegion();
  renderRegionList();
}

function pickRegionFromFeature(feature) {
  if (!feature) return false;
  const picked = window.RegionEditorState.regionFromFeature(feature);
  activeRegion = regionCatalog.find((region) => region.name === picked.name) || picked;
  renderActiveRegion();
  renderRegionList();
  editStatus.textContent = `Picked ${picked.name} from ${feature.properties.NAME_3}. Mode: ${paintScope}.`;
  return true;
}

function renderRegionList() {
  const filter = regionSearch.value;
  regionList.innerHTML = "";
  for (const region of regionCatalog) {
    if (!window.RegionEditorState.matchesRegionCatalogItem(region, filter)) continue;
    const button = document.createElement("button");
    button.className = `regionOption${activeRegion && activeRegion.name === region.name ? " active" : ""}`;
    button.type = "button";
    button.innerHTML = `<span class="swatchChip"></span><span>${escapeHtml(region.name)}</span><span class="regionCount">${region.count}</span>`;
    button.querySelector(".swatchChip").style.background = region.fill;
    button.addEventListener("click", () => selectEditorRegion(region.name));
    regionList.appendChild(button);
  }
}

function setEditorOpen(open) {
  if (open && !editorEnabled) return;
  editorOpen = open;
  if (!editorOpen) editorPanelCollapsed = false;
  editorPanel.classList.toggle("open", editorOpen);
  editorPanel.classList.toggle("collapsed", editorPanelCollapsed);
  editorPanel.setAttribute("aria-hidden", String(!editorOpen || editorPanelCollapsed));
  editorToggle.classList.toggle("active", editorOpen);
  editorToggle.textContent = editorOpen ? (editorPanelCollapsed ? "Show tools" : "Painting on") : "Edit regions";
  editorToggle.title = editorOpen
    ? (editorPanelCollapsed ? "Show painting tools" : "Turn off painting")
    : "Edit food-region assignments";
  canvas.style.cursor = editorOpen ? "crosshair" : "";
}

function setEditorPanelCollapsed(collapsed) {
  editorPanelCollapsed = Boolean(collapsed);
  if (editorPanelCollapsed && !editorOpen) return;
  editorPanel.classList.toggle("collapsed", editorPanelCollapsed);
  editorPanel.setAttribute("aria-hidden", String(!editorOpen || editorPanelCollapsed));
  editorToggle.textContent = editorPanelCollapsed ? "Show tools" : "Painting on";
  editorToggle.title = editorPanelCollapsed ? "Show painting tools" : "Turn off painting";
}

function setPaintScope(scope) {
  paintScope = scope === "prefecture" ? "prefecture" : "county";
  for (const button of paintScopeButtons) {
    button.classList.toggle("active", button.dataset.paintScope === paintScope);
  }
  persistOverrides();
}

function initializeEditor() {
  regionCatalog = window.RegionEditorState.buildRegionCatalog(countyFeatures);
  activeRegion = regionCatalog[0] || null;
  regionOverrides = loadStoredOverrides();
  window.RegionEditorState.applyStoredOverrides(countyFeatures, regionOverrides);
  persistOverrides();
  renderActiveRegion();
  renderRegionList();

  window.getFoodRegionCorrections = () => window.RegionEditorState.serializeOverrides(regionOverrides);
  window.clearFoodRegionCorrections = () => {
    regionOverrides = {};
    correctionHistory = [];
    restoreDefaultAssignments();
    invalidateBaseLayer();
    persistOverrides();
    draw();
  };
  window.RegionEditor = {
    applyCorrection(gid, regionName) {
      const feature = countyFeatures.find((item) => item.properties.GID_3 === gid);
      const region = regionCatalog.find((item) => item.name === regionName);
      if (!feature || !region) return false;
      activeRegion = region;
      paintFeature(feature);
      renderActiveRegion();
      renderRegionList();
      return true;
    },
    clear: window.clearFoodRegionCorrections,
    getCorrections: window.getFoodRegionCorrections,
    getCounty(gid) {
      const feature = countyFeatures.find((item) => item.properties.GID_3 === gid);
      return feature ? { ...feature.properties } : null;
    },
    pickRegion(gid) {
      const feature = countyFeatures.find((item) => item.properties.GID_3 === gid);
      return pickRegionFromFeature(feature);
    },
    setPaintScope,
  };
}

function restoreDefaultAssignments() {
  for (const feature of countyFeatures) {
    feature.properties.region = feature.properties.defaultRegion;
    feature.properties.fill = feature.properties.defaultFill;
  }
}

function prefectureKey(feature) {
  const props = feature.properties;
  return props.GID_2 || `${props.NAME_1}\u0000${props.NAME_2}`;
}

function paintTargetsForFeature(feature) {
  if (paintScope !== "prefecture") return [feature];
  const key = prefectureKey(feature);
  return countyFeatures.filter((item) => prefectureKey(item) === key);
}

function paintFeature(feature) {
  if (!activeRegion) return;
  const targets = paintTargetsForFeature(feature);
  correctionHistory.push({
    scope: paintScope,
    entries: targets.map((target) => {
      const gid = target.properties.GID_3;
      return {
        gid,
        previousOverride: regionOverrides[gid] ? { ...regionOverrides[gid] } : null,
        previousRegion: target.properties.region,
        previousFill: target.properties.fill,
      };
    }),
  });
  for (const target of targets) {
    window.RegionEditorState.setCountyRegion(regionOverrides, target, activeRegion);
  }
  selectedFeature = feature;
  invalidateBaseLayer();
  persistOverrides();
  draw();
}

function undoLastCorrection() {
  const last = correctionHistory.pop();
  if (!last) return;
  const entries = last.entries || [last];
  for (const entry of entries) {
    const feature = countyFeatures.find((item) => item.properties.GID_3 === entry.gid);
    if (!feature) continue;
    feature.properties.region = entry.previousRegion;
    feature.properties.fill = entry.previousFill;
    if (entry.previousOverride) {
      regionOverrides[entry.gid] = entry.previousOverride;
    } else {
      delete regionOverrides[entry.gid];
    }
  }
  invalidateBaseLayer();
  persistOverrides();
  draw();
}

function clearCorrections() {
  regionOverrides = {};
  correctionHistory = [];
  restoreDefaultAssignments();
  invalidateBaseLayer();
  persistOverrides();
  draw();
}

async function copyCorrections() {
  const text = window.RegionEditorState.serializeOverrides(regionOverrides);
  correctionsOutput.value = text;
  correctionsOutput.focus();
  correctionsOutput.select();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
  }
}

function selectFeature(feature) {
  selectedFeature = feature;
  draw();
  sidebar.classList.add("open");

  const props = feature.properties;
  flyToRegion(props.region);
  const details = regionDetails.get(props.region);
  let html = "";
  const displayRegionName = REGION_DISPLAY_NAMES[props.region] || props.region;
  html += `<div id="sideHeader"><h2>${escapeHtml(displayRegionName)}</h2>`;
  html += `<button id="closeBtn" title="Close">&times;</button></div>`;
  html += `<div id="sideContent">`;
  html += `<p class="para"><strong>${escapeHtml(props.NAME_3)}</strong>, ${escapeHtml(props.NAME_2)}, ${escapeHtml(props.NAME_1)}</p>`;

  if (details && details.images.length) {
    for (const group of imageGroups(details.images)) {
      if (group.name) html += `<h3 class="galleryGroupTitle">${escapeHtml(group.name)}</h3>`;
      html += `<div class="${galleryClassForCount(group.items.length)}">`;
      group.items.forEach(({ image, index }) => {
        const caption = image.caption || props.region;
        html += `<div class="galleryItem">`;
        html += `<button class="galleryImageButton" type="button" data-image-index="${index}" title="Open ${escapeHtml(caption)}">`;
        html += `<img src="${escapeHtml(image.src)}" loading="lazy" alt="${escapeHtml(caption)}" />`;
        html += `</button>`;
        if (image.caption) html += `<p class="imgCaption">${escapeHtml(image.caption)}</p>`;
        html += `</div>`;
      });
      html += `</div>`;
    }
  }
  if (details && details.paragraphs.length) {
    details.paragraphs.forEach((paragraph) => {
      html += `<p class="para">${escapeHtml(paragraph)}</p>`;
    });
  } else {
    html += `<div class="empty">No detailed write-up for this subregion in the source article.</div>`;
  }
  html += "</div>";

  sidebarInner.innerHTML = html;
  sidebar.scrollTop = 0;
  document.getElementById("closeBtn").addEventListener("click", closeSidebar);
  sidebarInner.querySelectorAll(".galleryImageButton").forEach((button) => {
    button.addEventListener("click", () => {
      const image = details.images[Number(button.dataset.imageIndex)];
      if (image) openImageLightbox(image, props.region);
    });
  });
}

function closeSidebar() {
  sidebar.classList.remove("open");
  selectedFeature = null;
  draw();
}

function openImageLightbox(image, regionName) {
  imageLightboxImg.src = image.src;
  imageLightboxImg.alt = image.caption || regionName;
  imageLightboxCaption.textContent = image.caption || regionName;
  imageLightbox.classList.add("open");
  imageLightbox.setAttribute("aria-hidden", "false");
}

function closeImageLightbox() {
  imageLightbox.classList.remove("open");
  imageLightbox.setAttribute("aria-hidden", "true");
  imageLightboxImg.removeAttribute("src");
}

function buildRegionDetails() {
  regionDetails = new Map();
  for (const feature of Object.values(mapData.features || {})) {
    if (!regionDetails.has(feature.name)) {
      regionDetails.set(feature.name, {
        paragraphs: feature.paragraphs || [],
        images: feature.images || [],
      });
    }
  }
  for (const [name, media] of Object.entries(articleMedia || {})) {
    const existing = regionDetails.get(name) || { paragraphs: [], images: [] };
    regionDetails.set(name, {
      paragraphs: media.paragraphs && media.paragraphs.length ? media.paragraphs : existing.paragraphs,
      images: media.images && media.images.length ? media.images : existing.images,
      source: media.source,
    });
  }
}

function featureCenter(feature) {
  const [x0, y0, x1, y1] = feature.bbox;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

function ringCentroid(ring) {
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const [x0, y0] = project(ring[index][0], ring[index][1]);
    const next = ring[(index + 1) % ring.length];
    const [x1, y1] = project(next[0], next[1]);
    const cross = x0 * y1 - x1 * y0;
    area2 += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (Math.abs(area2) < 0.0001) return null;
  return {
    x: cx / (3 * area2),
    y: cy / (3 * area2),
    area: Math.abs(area2 / 2),
  };
}

function featureCentroid(feature) {
  const polygons = feature.geometry.type === "Polygon" ? [feature.geometry.coordinates] : feature.geometry.coordinates;
  let weightedX = 0;
  let weightedY = 0;
  let totalArea = 0;
  for (const polygon of polygons) {
    const centroid = ringCentroid(polygon[0]);
    if (!centroid) continue;
    weightedX += centroid.x * centroid.area;
    weightedY += centroid.y * centroid.area;
    totalArea += centroid.area;
  }
  if (!totalArea) {
    const [x0, y0, x1, y1] = feature.bbox;
    return { ...featureCenter(feature), area: Math.max(1, (x1 - x0) * (y1 - y0)) };
  }
  return { x: weightedX / totalArea, y: weightedY / totalArea, area: totalArea };
}

function pointInAnyFeature(features, point) {
  return features.some((feature) => bboxContains(feature, point.x, point.y) && ctx.isPointInPath(feature.path, point.x, point.y));
}

function regionLabelPoint(stat) {
  if (stat.centroidArea && pointInAnyFeature(stat.features, stat.centroid)) return stat.centroid;
  const largestCentroid = featureCentroid(stat.largest);
  if (pointInAnyFeature([stat.largest], largestCentroid)) return largestCentroid;
  return featureCenter(stat.largest);
}

function buildRegionStats() {
  const stats = new Map();
  for (const feature of countyFeatures) {
    const region = feature.properties.region;
    const [x0, y0, x1, y1] = feature.bbox;
    const area = Math.max(1, (x1 - x0) * (y1 - y0));
    const centroid = featureCentroid(feature);
    if (!stats.has(region)) {
      stats.set(region, {
        bbox: [Infinity, Infinity, -Infinity, -Infinity],
        features: [],
        largest: feature,
        largestArea: 0,
        totalArea: 0,
        centroid: { x: 0, y: 0 },
        centroidArea: 0,
      });
    }
    const stat = stats.get(region);
    includePoint(stat.bbox, x0, y0);
    includePoint(stat.bbox, x1, y1);
    stat.features.push(feature);
    stat.totalArea += area;
    stat.centroid.x += centroid.x * centroid.area;
    stat.centroid.y += centroid.y * centroid.area;
    stat.centroidArea += centroid.area;
    if (area > stat.largestArea) {
      stat.largest = feature;
      stat.largestArea = area;
    }
  }
  for (const stat of stats.values()) {
    if (stat.centroidArea) {
      stat.centroid.x /= stat.centroidArea;
      stat.centroid.y /= stat.centroidArea;
    } else {
      stat.centroid = featureCenter(stat.largest);
    }
  }
  return stats;
}

function buildLabels() {
  const stats = buildRegionStats();
  labelLayer.innerHTML = "";
  labelEls = [...stats.entries()]
    .sort((a, b) => b[1].totalArea - a[1].totalArea || a[0].localeCompare(b[0]))
    .map(([name, stat]) => {
    const el = document.createElement("div");
    el.className = "mapLabel";
    el.textContent = name.toUpperCase();
    labelLayer.appendChild(el);

    const target = regionLabelPoint(stat);
    return {
      el,
      name,
      x: target.x,
      y: target.y,
      targetX: target.x,
      targetY: target.y,
      callout: false,
      priority: Math.log(stat.totalArea + 1),
    };
  });
}

function initialize(data, geo, colors, media) {
  mapData = data;
  regionGeo = geo;
  regionColors = colors;
  articleMedia = media || {};
  window.RegionEditorState.setRegionColors(regionColors);
  buildRegionDetails();
  countyFeatures = regionGeo.features.map((feature) => prepareFeature(feature, 3));
  countyFeatures.forEach((feature) => {
    feature.properties.defaultRegion = feature.properties.region;
    feature.properties.defaultFill = feature.properties.fill;
  });
  prefectureFeatures = regionGeo.prefectures.features.map((feature) => prepareFeature(feature, 2));
  spatialIndex = window.MapSpatialIndex.buildSpatialIndex(countyFeatures, 96);
  initializeEditor();
  bounds = computeBounds(countyFeatures);
  buildLabels();
  fitToScreen();
  resizeCanvas();
}

Promise.all([
  new Promise((resolve) => {
    regionOutlineImg.onload = resolve;
    regionOutlineImg.onerror = resolve;
  }),
  fetch("assets/map_data.json?v=source-credit").then((response) => response.json()),
  fetch("assets/region_geojson.json?v=source-credit").then((response) => response.json()),
  fetch("assets/region_colors.json?v=source-credit").then((response) => response.json()),
  fetch("assets/article_media.json?v=source-credit").then((response) => response.json()),
]).then(([, data, geo, colors, media]) => initialize(data, geo, colors, media)).catch((error) => {
  console.error(error);
  sidebarInner.innerHTML = `<div class="empty" style="padding:60px 24px;">Map data could not be loaded.</div>`;
});

window.addEventListener("resize", resizeCanvas);

imageLightboxClose.addEventListener("click", closeImageLightbox);
imageLightbox.addEventListener("click", (event) => {
  if (event.target === imageLightbox) closeImageLightbox();
});
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && imageLightbox.classList.contains("open")) closeImageLightbox();
});
document.addEventListener("pointerdown", (event) => {
  if (!sidebar.classList.contains("open")) return;
  if (sidebar.contains(event.target)) return;
  if (imageLightbox.contains(event.target)) return;
  if (editorPanel.contains(event.target) || editorToggle.contains(event.target)) return;
  if (event.target === canvas) return;
  closeSidebar();
});

canvas.addEventListener("wheel", (event) => {
  event.preventDefault();
  if (flyRaf) cancelAnimationFrame(flyRaf);
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
  const targetScale = Math.min(maxScale, Math.max(minScale, scale * factor));
  const p = screenToWorld(event.clientX, event.clientY);
  scale = targetScale;
  tx = event.clientX - p.x * scale;
  ty = event.clientY - p.y * scale;
  draw();
}, { passive: false });

canvas.addEventListener("dblclick", (event) => {
  const p = screenToWorld(event.clientX, event.clientY);
  const targetScale = Math.min(maxScale, scale * 1.8);
  animateTo(targetScale, event.clientX - p.x * targetScale, event.clientY - p.y * targetScale, 300);
});

canvas.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  const feature = featureAt(event.clientX, event.clientY);
  if (feature) {
    if (!editorEnabled) return;
    if (!editorOpen) setEditorOpen(true);
    pickRegionFromFeature(feature);
  }
});

let isDown = false;
let isDragging = false;
let lastX = 0;
let lastY = 0;
let downX = 0;
let downY = 0;

canvas.addEventListener("pointerdown", (event) => {
  if (!window.MapInputEvents.isPrimaryButtonEvent(event)) return;
  if (flyRaf) cancelAnimationFrame(flyRaf);
  isDown = true;
  isDragging = false;
  lastX = event.clientX;
  lastY = event.clientY;
  downX = event.clientX;
  downY = event.clientY;
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  if (isDown) {
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    if (!isDragging && (Math.abs(event.clientX - downX) > 4 || Math.abs(event.clientY - downY) > 4)) {
      isDragging = true;
      canvas.classList.add("panning");
      hoverLabel.style.display = "none";
    }
    if (isDragging) {
      tx += dx;
      ty += dy;
      lastX = event.clientX;
      lastY = event.clientY;
      draw();
      return;
    }
  }

  scheduleHover(event.clientX, event.clientY);
});

canvas.addEventListener("pointerup", (event) => {
  canvas.classList.remove("panning");
  if (!window.MapInputEvents.isPrimaryButtonEvent(event)) {
    isDown = false;
    isDragging = false;
    return;
  }
  if (!isDragging) {
    const feature = featureAt(event.clientX, event.clientY);
    if (feature && editorOpen) {
      paintFeature(feature);
    } else if (feature) {
      selectFeature(feature);
    } else if (sidebar.classList.contains("open")) {
      closeSidebar();
    }
  }
  isDown = false;
  isDragging = false;
});

canvas.addEventListener("pointerleave", () => {
  hoverLabel.style.display = "none";
  if (hoverFeature) {
    hoverFeature = null;
    draw();
  }
});

document.getElementById("zoomInBtn").addEventListener("click", () => zoomBy(1.5));
document.getElementById("zoomOutBtn").addEventListener("click", () => zoomBy(1 / 1.5));
document.getElementById("resetViewBtn").addEventListener("click", () => {
  closeSidebar();
  const t = computeFitTransform();
  animateTo(t.scale, t.tx, t.ty, 460);
});

editorToggle.addEventListener("click", () => {
  if (!editorEnabled) return;
  if (editorOpen && editorPanelCollapsed) {
    setEditorPanelCollapsed(false);
    return;
  }
  setEditorOpen(!editorOpen);
});
hideEditorPanelBtn.addEventListener("click", () => setEditorPanelCollapsed(true));
paintScopeButtons.forEach((button) => {
  button.addEventListener("click", () => setPaintScope(button.dataset.paintScope));
});
regionSearch.addEventListener("input", renderRegionList);
refreshExportBtn.addEventListener("click", persistOverrides);
undoCorrectionBtn.addEventListener("click", undoLastCorrection);
clearCorrectionsBtn.addEventListener("click", clearCorrections);
copyCorrectionsBtn.addEventListener("click", () => {
  copyCorrections().catch((error) => {
    console.warn("Could not copy corrections", error);
  });
});
