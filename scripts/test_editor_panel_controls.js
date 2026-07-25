const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const indexHtml = fs.readFileSync(path.join(root, "index.html"), "utf8");
const mapJs = fs.readFileSync(path.join(root, "assets", "map.js"), "utf8");

assert.match(indexHtml, /id="hideEditorPanelBtn"/, "editor panel needs a hide control");
assert.match(indexHtml, /id="editorPanel"\s+aria-label="Food region editor"/, "editor panel keeps its accessible label");
assert.match(mapJs, /let editorPanelCollapsed = false;/, "map state tracks hidden paint panel separately from painting mode");
assert.match(indexHtml, /id="editorToggle"[^>]*disabled/, "edit regions button should be disabled");
assert.match(indexHtml, /id="editorToggle"[^>]*aria-hidden="true"/, "edit regions button should be hidden from accessibility");
assert.match(indexHtml, /#editorToggle\{\s*display:none;/, "edit regions button should be invisible");
assert.match(mapJs, /const editorEnabled = false;/, "map code should keep region editing disabled");
assert.match(mapJs, /function setEditorPanelCollapsed\(collapsed\)/, "map code exposes a panel-only hide/show transition");
assert.match(mapJs, /hideEditorPanelBtn\.addEventListener\("click", \(\) => setEditorPanelCollapsed\(true\)\)/, "hide button only collapses the panel");
assert.match(mapJs, /if \(open && !editorEnabled\) return;/, "setEditorOpen should refuse to open when editing is disabled");
assert.match(mapJs, /editorToggle\.addEventListener\("click", \(\) => \{\s*if \(!editorEnabled\) return;/, "disabled editor toggle should not open painting tools");
assert.match(mapJs, /labelEls = \[\.\.\.stats\.entries\(\)\]/, "food-region labels are recalculated from current generated region geometry");
assert.doesNotMatch(mapJs, /labelEls = \(mapData\.labels \|\| \[\]\)\.map/, "food-region labels must not depend on stale comparison-map label rows");
assert.match(mapJs, /function flyToRegion\(regionName\)/, "map click navigation should support zooming to an entire food region");
assert.match(mapJs, /flyToRegion\(props\.region\)/, "selecting a county should zoom to the selected food region, not just the county");
