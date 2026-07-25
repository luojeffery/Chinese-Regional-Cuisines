import json
import math
from collections import Counter
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
GEOJSONS = ASSETS / "geojsons"
OUT_PATH = ASSETS / "region_geojson.json"
OUTLINE_PATH = ASSETS / "region_outlines.png"
MANUAL_OVERRIDES_PATH = ASSETS / "manual_region_overrides.json"
REGION_COLORS_PATH = ASSETS / "region_colors.json"
REGION_OUTLINE_WIDTH_PX = 0
TAIWAN_LEVEL1_PATH = GEOJSONS / "taiwan" / "gadm41_TWN_1.json"
TAIWAN_LEVEL2_PATH = GEOJSONS / "taiwan" / "gadm41_TWN_2.json"

PREFECTURE_REGION_OVERRIDES = {
    ("Shanghai", "Shanghai"): "Shanghai",
    ("Zhejiang", "Ningbo"): "Ningbo",
    ("Zhejiang", "Shaoxing"): "Shaoxing",
    ("Zhejiang", "Wenzhou"): "Ou",
    ("Fujian", "Fuzhou"): "Minbei",
    ("Fujian", "Nanping"): "Minbei",
    ("Fujian", "Ningde"): "Minbei",
    ("Fujian", "Putian"): "Minnan",
    ("Fujian", "Quanzhou"): "Minnan",
    ("Fujian", "Xiamen"): "Minnan",
    ("Fujian", "Zhangzhou"): "Minnan",
    ("Fujian", "Longyan"): "West Fujian Mountains",
    ("Fujian", "Sanming"): "West Fujian Mountains",
    ("Guangdong", "Chaozhou"): "Teochew",
    ("Guangdong", "Jieyang"): "Teochew",
    ("Guangdong", "Shantou"): "Teochew",
}


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_manual_overrides():
    if not MANUAL_OVERRIDES_PATH.exists():
        return {}
    return load_json(MANUAL_OVERRIDES_PATH)


def hex_color(rgb):
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def fill_for_region(region, fill, region_colors):
    return region_colors.get(region, fill)


def projected_point(lon, lat, transform):
    sx, ox, sy, oy = transform
    return lon * sx + ox, -lat * sy + oy


def geometry_polygons(geometry, transform):
    if geometry["type"] == "Polygon":
        polygons = [geometry["coordinates"]]
    elif geometry["type"] == "MultiPolygon":
        polygons = geometry["coordinates"]
    else:
        return []

    projected = []
    for polygon in polygons:
        rings = []
        for ring in polygon:
            rings.append([projected_point(lon, lat, transform) for lon, lat in ring])
        projected.append(rings)
    return projected


def point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i, (xi, yi) in enumerate(ring):
        xj, yj = ring[j]
        crosses = (yi > y) != (yj > y)
        if crosses:
            x_at_y = (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi
            if x < x_at_y:
                inside = not inside
        j = i
    return inside


def point_in_polygon(x, y, polygon):
    if not polygon or not point_in_ring(x, y, polygon[0]):
        return False
    return not any(point_in_ring(x, y, hole) for hole in polygon[1:])


def polygon_bbox(polygon):
    xs = [x for ring in polygon for x, _ in ring]
    ys = [y for ring in polygon for _, y in ring]
    return min(xs), min(ys), max(xs), max(ys)


def polygons_bbox(polygons):
    boxes = [polygon_bbox(polygon) for polygon in polygons]
    return (
        min(box[0] for box in boxes),
        min(box[1] for box in boxes),
        max(box[2] for box in boxes),
        max(box[3] for box in boxes),
    )


def rgb_distance(a, b):
    return math.sqrt(sum((a[i] - b[i]) ** 2 for i in range(3)))


def is_fill_color(rgb):
    r, g, b = rgb
    if r > 245 and g > 245 and b > 245:
        return False
    if r < 35 and g < 35 and b < 35:
        return False
    if max(rgb) - min(rgb) < 18:
        return False
    return True


def derive_palette(image):
    pixels = image.get_flattened_data() if hasattr(image, "get_flattened_data") else image.getdata()
    counts = Counter(pixels)
    palette = []
    for rgb, count in counts.most_common():
        if count < 500:
            break
        if not is_fill_color(rgb):
            continue
        if any(rgb_distance(rgb, item["color"]) < 12 for item in palette):
            continue
        palette.append({"color": list(rgb), "pixel_count": count})
    return palette


def component_at(x, y, rgb, components):
    best_id = None
    best_dist = 999
    for idx, component in enumerate(components):
        dist = rgb_distance(rgb, component["color"])
        if dist < best_dist:
            best_id = idx
            best_dist = dist
    if best_dist <= 45:
        return best_id
    return None


def nearest_component_around(cx, cy, image, components):
    width, height = image.size
    cx = int(round(max(0, min(width - 1, cx))))
    cy = int(round(max(0, min(height - 1, cy))))
    for radius in (0, 2, 4, 8, 14, 22, 34, 50, 72):
        best = None
        best_dist = 999
        for y in range(max(0, cy - radius), min(height - 1, cy + radius) + 1, max(1, radius // 4 or 1)):
            for x in range(max(0, cx - radius), min(width - 1, cx + radius) + 1, max(1, radius // 4 or 1)):
                rgb = image.getpixel((x, y))[:3]
                component_id = component_at(x, y, rgb, components)
                if component_id is None:
                    continue
                dist = math.hypot(x - cx, y - cy)
                if dist < best_dist:
                    best = component_id
                    best_dist = dist
        if best is not None:
            return best
    return None


def scaled_region_boxes(map_data, image_size):
    sx = image_size[0] / map_data["width"]
    sy = image_size[1] / map_data["height"]
    boxes = []
    for feature in map_data["features"].values():
        x0, y0, x1, y1 = feature["bbox"]
        box = (x0 * sx, y0 * sy, x1 * sx, y1 * sy)
        area = max(1, (box[2] - box[0]) * (box[3] - box[1]))
        boxes.append({"name": feature["name"], "box": box, "area": area, "color_ids": set()})
    return boxes


def scaled_labels(map_data, image_size):
    sx = image_size[0] / map_data["width"]
    sy = image_size[1] / map_data["height"]
    return [(label["name"], label["x"] * sx, label["y"] * sy) for label in map_data["labels"]]


def attach_region_box_colors(region_boxes, image, components):
    width, height = image.size
    for item in region_boxes:
        x0, y0, x1, y1 = item["box"]
        x0 = max(0, math.floor(x0))
        y0 = max(0, math.floor(y0))
        x1 = min(width - 1, math.ceil(x1))
        y1 = min(height - 1, math.ceil(y1))
        span = max(1, max(x1 - x0, y1 - y0))
        step = max(2, math.ceil(span / 70))
        counts = Counter()
        for yy in range(y0, y1 + 1, step):
            for xx in range(x0, x1 + 1, step):
                rgb = image.getpixel((xx, yy))[:3]
                component_id = component_at(xx, yy, rgb, components)
                if component_id is not None:
                    counts[component_id] += 1
        item["color_ids"] = {component_id for component_id, _ in counts.most_common(5)}


def region_for_point(x, y, component_id, region_boxes, labels):
    containing = []
    for item in region_boxes:
        name = item["name"]
        box = item["box"]
        area = item["area"]
        x0, y0, x1, y1 = box
        if x0 <= x <= x1 and y0 <= y <= y1:
            color_penalty = 0 if component_id in item["color_ids"] else 1
            bx = (x0 + x1) / 2
            by = (y0 + y1) / 2
            containing.append((color_penalty, area, math.hypot(x - bx, y - by), name))
    if containing:
        return min(containing)[3]
    return min(labels, key=lambda item: math.hypot(x - item[1], y - item[2]))[0]


def county_assignment(feature, image, components, transform, region_boxes, labels):
    polygons = geometry_polygons(feature["geometry"], transform)
    counts = Counter()
    sample_points = []
    width, height = image.size
    if not polygons:
        return None
    gx0, gy0, gx1, gy1 = polygons_bbox(polygons)
    fallback_cx = (gx0 + gx1) / 2
    fallback_cy = (gy0 + gy1) / 2

    for polygon in polygons:
        x0, y0, x1, y1 = polygon_bbox(polygon)
        x0 = max(0, math.floor(x0))
        y0 = max(0, math.floor(y0))
        x1 = min(width - 1, math.ceil(x1))
        y1 = min(height - 1, math.ceil(y1))
        if x1 < x0 or y1 < y0:
            continue

        span = max(x1 - x0, y1 - y0)
        step = max(1, min(12, math.ceil(span / 18)))
        for y in range(y0, y1 + 1, step):
            for x in range(x0, x1 + 1, step):
                px = x + 0.5
                py = y + 0.5
                if not point_in_polygon(px, py, polygon):
                    continue
                rgb = image.getpixel((x, y))[:3]
                component_id = component_at(x, y, rgb, components)
                if component_id is None:
                    continue
                counts[component_id] += 1
                sample_points.append((px, py))

    if not counts:
        component_id = nearest_component_around(fallback_cx, fallback_cy, image, components)
        if component_id is None:
            return None
        counts[component_id] += 1

    component_id = counts.most_common(1)[0][0]
    fill = hex_color(components[component_id]["color"])
    if sample_points:
        cx = sum(point[0] for point in sample_points) / len(sample_points)
        cy = sum(point[1] for point in sample_points) / len(sample_points)
    else:
        cx = fallback_cx
        cy = fallback_cy

    return {
        "region": region_for_point(cx, cy, component_id, region_boxes, labels),
        "fill": fill,
        "component_id": component_id,
        "sample_count": sum(counts.values()),
    }


def clean_county_feature(feature, assignment):
    props = feature["properties"]
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            "level": 3,
            "region": assignment["region"],
            "fill": assignment["fill"],
            "component_id": assignment["component_id"],
            "sample_count": assignment["sample_count"],
            "GID_3": props["GID_3"],
            "GID_2": props.get("GID_2", ""),
            "NAME_1": props["NAME_1"],
            "NAME_2": props["NAME_2"],
            "NAME_3": props["NAME_3"],
            "NL_NAME_2": props.get("NL_NAME_2", ""),
            "NL_NAME_3": props.get("NL_NAME_3", ""),
            "TYPE_3": props.get("TYPE_3", ""),
            "ENGTYPE_3": props.get("ENGTYPE_3", ""),
        },
    }


def projected_features_bounds(features, transform):
    box = [math.inf, math.inf, -math.inf, -math.inf]
    for feature in features:
        for polygon in geometry_polygons(feature["geometry"], transform):
            x0, y0, x1, y1 = polygon_bbox(polygon)
            box[0] = min(box[0], x0)
            box[1] = min(box[1], y0)
            box[2] = max(box[2], x1)
            box[3] = max(box[3], y1)
    return box


def render_size_for_features(features, transform, minimum_size):
    box = projected_features_bounds(features, transform)
    pad = 12
    return (
        max(minimum_size[0], math.ceil(box[2] + pad)),
        max(minimum_size[1], math.ceil(box[3] + pad)),
    )


def hong_kong_district_as_county(feature):
    props = feature["properties"]
    synthetic = {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            **props,
            "GID_3": props["GID_2"],
            "GID_2": props["GID_2"],
            "NAME_3": props["NAME_2"],
            "NL_NAME_3": props.get("NL_NAME_2", ""),
            "TYPE_3": props.get("TYPE_2", ""),
            "ENGTYPE_3": props.get("ENGTYPE_2", ""),
        },
    }
    return synthetic


def taiwan_area_as_county(feature):
    props = feature["properties"]
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            **props,
            "GID_3": props["GID_2"],
            "GID_2": props["GID_1"],
            "NAME_1": "Taiwan",
            "NAME_2": props["NAME_1"],
            "NAME_3": props["NAME_2"],
            "NL_NAME_2": props.get("NL_NAME_1", ""),
            "NL_NAME_3": props.get("NL_NAME_2", ""),
            "TYPE_3": props.get("TYPE_2", ""),
            "ENGTYPE_3": props.get("ENGTYPE_2", ""),
        },
    }


def taiwan_area_as_prefecture(feature):
    props = feature["properties"]
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            **props,
            "GID_2": props["GID_1"],
            "NAME_1": "Taiwan",
            "NAME_2": props["NAME_1"],
            "NL_NAME_2": props.get("NL_NAME_1", ""),
            "TYPE_2": props.get("TYPE_1", ""),
            "ENGTYPE_2": props.get("ENGTYPE_1", ""),
        },
    }


def override_assignment(properties, manual_overrides):
    manual = manual_overrides.get(properties["GID_3"])
    if manual:
        return manual
    region = PREFECTURE_REGION_OVERRIDES.get((properties["NAME_1"], properties["NAME_2"]))
    if region:
        return {"region": region}
    return None


def clean_prefecture_feature(feature):
    props = feature["properties"]
    return {
        "type": "Feature",
        "geometry": feature["geometry"],
        "properties": {
            "level": 2,
            "GID_2": props["GID_2"],
            "NAME_1": props["NAME_1"],
            "NAME_2": props["NAME_2"],
            "NL_NAME_2": props.get("NL_NAME_2", ""),
            "TYPE_2": props.get("TYPE_2", ""),
            "ENGTYPE_2": props.get("ENGTYPE_2", ""),
        },
    }


def draw_ring(draw, ring, transform, value):
    points = [projected_point(lon, lat, transform) for lon, lat in ring]
    if len(points) >= 3:
        draw.polygon(points, fill=value)


def build_region_outline_image(county_features, transform, size):
    if REGION_OUTLINE_WIDTH_PX <= 0:
        Image.new("RGBA", size, (0, 0, 0, 0)).save(OUTLINE_PATH)
        return

    region_ids = {}
    next_id = 1
    mask = Image.new("I", size, 0)
    draw = ImageDraw.Draw(mask)

    for feature in county_features:
        region = feature["properties"]["region"]
        if region not in region_ids:
            region_ids[region] = next_id
            next_id += 1
        value = region_ids[region]
        geometry = feature["geometry"]
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for polygon in polygons:
            if not polygon:
                continue
            draw_ring(draw, polygon[0], transform, value)
            for hole in polygon[1:]:
                draw_ring(draw, hole, transform, 0)

    width, height = size
    pixels = mask.load()
    outline = Image.new("RGBA", size, (0, 0, 0, 0))
    out = outline.load()
    for y in range(height - 1):
        for x in range(width - 1):
            value = pixels[x, y]
            if value == 0:
                continue
            if pixels[x + 1, y] != value or pixels[x, y + 1] != value:
                out[x, y] = (0, 0, 0, 255)

    outline = outline.filter(ImageFilter.MaxFilter(REGION_OUTLINE_WIDTH_PX))
    outline.save(OUTLINE_PATH)


def main():
    image = Image.open(ASSETS / "comparison.png").convert("RGB")
    components = derive_palette(image)
    transform = load_json(GEOJSONS / "transform.json")
    map_data = load_json(ASSETS / "map_data.json")
    level3 = load_json(GEOJSONS / "lvl3" / "gadm41_CHN_3.json")
    level2 = load_json(GEOJSONS / "lvl2" / "gadm41_CHN_2.json")
    taiwan_level1 = load_json(TAIWAN_LEVEL1_PATH) if TAIWAN_LEVEL1_PATH.exists() else {"features": []}
    taiwan_level2 = load_json(TAIWAN_LEVEL2_PATH) if TAIWAN_LEVEL2_PATH.exists() else {"features": []}
    manual_overrides = load_manual_overrides()
    region_colors = load_json(REGION_COLORS_PATH)

    region_boxes = scaled_region_boxes(map_data, image.size)
    attach_region_box_colors(region_boxes, image, components)
    labels = scaled_labels(map_data, image.size)

    county_features = []
    for feature in level3["features"]:
        assignment = county_assignment(feature, image, components, transform, region_boxes, labels)
        if assignment is not None:
            override = override_assignment(feature["properties"], manual_overrides)
            if override:
                assignment["region"] = override["region"]
                if override.get("fill"):
                    assignment["fill"] = override["fill"]
            assignment["fill"] = fill_for_region(assignment["region"], assignment["fill"], region_colors)
            county_features.append(clean_county_feature(feature, assignment))

    for feature in level2["features"]:
        if feature["properties"].get("NAME_1") != "HongKong":
            continue
        synthetic = hong_kong_district_as_county(feature)
        override = override_assignment(synthetic["properties"], manual_overrides) or {"region": "Hong Kong"}
        assignment = {
            "region": override["region"],
            "fill": override.get("fill", region_colors.get(override["region"], "#4461dc")),
            "component_id": -1,
            "sample_count": 0,
        }
        assignment["fill"] = fill_for_region(assignment["region"], assignment["fill"], region_colors)
        county_features.append(clean_county_feature(synthetic, assignment))

    for feature in taiwan_level2["features"]:
        synthetic = taiwan_area_as_county(feature)
        assignment = {
            "region": "Taiwan",
            "fill": region_colors["Taiwan"],
            "component_id": -1,
            "sample_count": 0,
        }
        county_features.append(clean_county_feature(synthetic, assignment))

    prefecture_features = [clean_prefecture_feature(feature) for feature in level2["features"]]
    prefecture_features.extend(clean_prefecture_feature(taiwan_area_as_prefecture(feature)) for feature in taiwan_level1["features"])
    render_size = render_size_for_features(county_features + prefecture_features, transform, image.size)
    build_region_outline_image(county_features, transform, render_size)
    output = {
        "type": "FeatureCollection",
        "metadata": {
            "source_image": "assets/comparison.png",
            "level3_source": "assets/geojsons/lvl3/gadm41_CHN_3.json",
            "level2_source": "assets/geojsons/lvl2/gadm41_CHN_2.json",
            "manual_overrides": "assets/manual_region_overrides.json",
            "region_outline_image": "assets/region_outlines.png",
            "region_outline_width_px": REGION_OUTLINE_WIDTH_PX,
            "region_colors": "assets/region_colors.json",
            "source_image_size": list(image.size),
            "render_size": list(render_size),
            "transform": transform,
        },
        "features": county_features,
        "prefectures": {
            "type": "FeatureCollection",
            "features": prefecture_features,
        },
    }
    OUT_PATH.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT_PATH.relative_to(ROOT)}")
    print(f"county features: {len(county_features)}")
    print(f"prefecture features: {len(prefecture_features)}")
    print(f"regions: {len(set(f['properties']['region'] for f in county_features))}")


if __name__ == "__main__":
    main()
