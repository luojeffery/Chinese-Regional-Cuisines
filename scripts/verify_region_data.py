import json
import math
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
DATA_PATH = ROOT / "assets" / "region_geojson.json"
OUTLINE_PATH = ROOT / "assets" / "region_outlines.png"
REGION_COLORS_PATH = ROOT / "assets" / "region_colors.json"
MANUAL_OVERRIDES_PATH = ROOT / "assets" / "manual_region_overrides.json"
REGION_OUTLINE_WIDTH_PX = 0


def projected_point(lon, lat, transform):
    sx, ox, sy, oy = transform
    return lon * sx + ox, -lat * sy + oy


def iter_rings(geometry):
    if geometry["type"] == "Polygon":
        for ring in geometry["coordinates"]:
            yield ring
    elif geometry["type"] == "MultiPolygon":
        for polygon in geometry["coordinates"]:
            for ring in polygon:
                yield ring


def projected_bounds(features, transform):
    box = [math.inf, math.inf, -math.inf, -math.inf]
    for feature in features:
        for ring in iter_rings(feature["geometry"]):
            for lon, lat in ring:
                x, y = projected_point(lon, lat, transform)
                box[0] = min(box[0], x)
                box[1] = min(box[1], y)
                box[2] = max(box[2], x)
                box[3] = max(box[3], y)
    return box


def main():
    assert DATA_PATH.exists(), "assets/region_geojson.json must be generated"
    data = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    region_colors = json.loads(REGION_COLORS_PATH.read_text(encoding="utf-8"))
    manual_overrides = json.loads(MANUAL_OVERRIDES_PATH.read_text(encoding="utf-8"))
    map_data = json.loads((ROOT / "assets" / "map_data.json").read_text(encoding="utf-8"))

    assert data["type"] == "FeatureCollection"
    assert data["features"], "expected county-level cuisine features"
    assert data["prefectures"]["type"] == "FeatureCollection"
    assert data["prefectures"]["features"], "expected level-2 prefecture outlines"
    assert data["metadata"]["manual_overrides"] == "assets/manual_region_overrides.json"
    assert data["metadata"]["region_outline_image"] == "assets/region_outlines.png"
    assert data["metadata"]["region_outline_width_px"] == REGION_OUTLINE_WIDTH_PX
    assert data["metadata"]["region_colors"] == "assets/region_colors.json"
    assert "render_size" in data["metadata"], "expected generated render size metadata"
    assert "source_image_size" in data["metadata"], "expected source image size metadata"
    assert "transform" in data["metadata"], "expected projection transform metadata"
    assert OUTLINE_PATH.exists(), "assets/region_outlines.png must be generated"
    with Image.open(OUTLINE_PATH) as outline:
        assert list(outline.size) == data["metadata"]["render_size"], (
            f"outline image expected size {data['metadata']['render_size']}, saw {outline.size}"
        )

    render_width, render_height = data["metadata"]["render_size"]
    source_width, source_height = data["metadata"]["source_image_size"]
    assert render_width >= source_width, "render width must not shrink below comparison image width"
    assert render_height >= source_height, "render height must not shrink below comparison image height"
    max_bounds = projected_bounds(data["features"] + data["prefectures"]["features"], data["metadata"]["transform"])
    assert max_bounds[2] <= render_width, f"projected geometry exceeds render width: {max_bounds[2]} > {render_width}"
    assert max_bounds[3] <= render_height, f"projected geometry exceeds render height: {max_bounds[3]} > {render_height}"

    map_regions = {feature["name"] for feature in map_data["features"].values()}
    missing_colors = sorted(map_regions - set(region_colors))
    assert not missing_colors, f"missing canonical colors for {missing_colors}"
    assert region_colors["She"] == "#d8d8d8"

    county_ids = set()
    regions = {}
    for feature in data["features"]:
        props = feature["properties"]
        assert feature["geometry"], f"{props.get('GID_3')} is missing geometry"
        assert props["level"] == 3
        assert props["GID_3"] not in county_ids, f"duplicate county {props['GID_3']}"
        assert props.get("GID_2"), f"{props['GID_3']} missing level-2 prefecture id"
        county_ids.add(props["GID_3"])
        assert props["region"], f"{props['GID_3']} missing cuisine region"
        assert props["fill"].startswith("#") and len(props["fill"]) == 7
        assert props["region"] in region_colors, f"{props['GID_3']} missing canonical color for {props['region']}"
        assert props["fill"] == region_colors[props["region"]], (
            f"{props['GID_3']} expected {props['region']} fill {region_colors[props['region']]}, saw {props['fill']}"
        )
        regions.setdefault(props["region"], 0)
        regions[props["region"]] += 1

    assert len(regions) >= 55, f"expected most source cuisine regions, saw {len(regions)}"
    assert len(county_ids) >= 2300, f"expected broad county coverage, saw {len(county_ids)}"
    assert regions.get("Taiwan"), "expected Taiwan generated area features"
    assert regions.get("Nanjing"), "expected Nanjing generated county features"
    assert regions.get("Ningbo"), "expected Ningbo generated county features"
    assert region_colors["Nanjing"] == "#23b526"
    assert region_colors["Ningbo"] == "#ae21ff"
    assert region_colors["Shanghai"] == "#ec7ca3"
    assert region_colors["Jinhua"] == "#46faf0"
    assert region_colors["Hangzhou"] == "#aceeea"
    assert region_colors["Jiangsu North"] == "#3f4cf5"
    assert region_colors["Shaanxi Central"] == "#50ffbd"
    assert region_colors["Shaanxi South"] == "#7fd0be"
    assert region_colors["Shaoxing"] == "#c61fff"

    expected_regions = {
        "CHN.3.1.28_1": ("Sichuan Lower River Gang", "#f3ff8b"),
        "CHN.14.9.1_1": ("Hunan West", "#ffdc17"),
        "CHN.14.9.3_1": ("Hunan West", "#ffdc17"),
        "CHN.14.6.4_1": ("Xiang", "#ff0202"),
        "CHN.14.4.4_1": ("Xiang", "#ff0202"),
        "CHN.26.12.5_1": ("Upper River Gang", "#c25052"),
        "CHN.26.16.10_1": ("The Tibetan Plateau", "#78d2ff"),
        "CHN.9.2.14_1": ("Straits Chinese", "#ff5bf5"),
        "CHN.6.11.2_1": ("Lianzhou Yao", "#d8d8d8"),
        "CHN.6.11.3_1": ("Lianzhou Yao", "#d8d8d8"),
        "CHN.6.11.4_1": ("Lianzhou Yao", "#d8d8d8"),
        "CHN.6.11.7_1": ("Lianzhou Yao", "#d8d8d8"),
        "CHN.6.14.5_1": ("Lianzhou Yao", "#d8d8d8"),
        "HKG.1_1": ("Hong Kong", "#00c884"),
        "HKG.18_1": ("Hong Kong", "#00c884"),
        "TWN.1.1_1": ("Taiwan", "#005aa3"),
        "TWN.7.3_1": ("Taiwan", "#005aa3"),
        "CHN.31.6.1_1": ("Ningbo", "#ae21ff"),
        "CHN.31.6.8_1": ("Ningbo", "#ae21ff"),
        "CHN.24.1.1_1": ("Shanghai", "#ec7ca3"),
        "CHN.24.1.12_1": ("Shanghai", "#ec7ca3"),
        "CHN.31.9.7_1": ("Ou", "#ff7f21"),
        "CHN.31.1.1_1": ("Hangzhou", "#aceeea"),
        "CHN.31.9.6_1": ("Ou", "#ff7f21"),
        "CHN.15.11.6_1": ("Classical Huaiyang (plus Tucai)", "#f54c3f"),
        "CHN.15.13.5_1": ("Classical Huaiyang (plus Tucai)", "#f54c3f"),
        "CHN.1.12.1_1": ("Lu’an", "#ffa335"),
        "CHN.10.1.1_1": ("Hebei", "#b6d4ec"),
        "CHN.12.14.1_1": ("Hubei", "#909adb"),
        "CHN.31.4.1_1": ("Jinhua", "#46faf0"),
        "CHN.31.5.1_1": ("She", "#d8d8d8"),
        "CHN.22.1.1_1": ("Shaanxi South", "#7fd0be"),
        "CHN.26.7.2_1": ("Upper River Gang", "#c25052"),
        "CHN.31.8.1_1": ("Shaoxing", "#c61fff"),
    }
    by_county = {feature["properties"]["GID_3"]: feature["properties"] for feature in data["features"]}
    for gid, override in manual_overrides.items():
        props = by_county.get(gid)
        assert props, f"{gid} manual override target not found in generated counties"
        assert props["region"] == override["region"], f"{gid} expected manual region {override['region']}, saw {props['region']}"
        assert props["fill"] == region_colors[override["region"]], (
            f"{gid} expected canonical fill {region_colors[override['region']]}, saw {props['fill']}"
        )

    for gid, (region, fill) in expected_regions.items():
        props = by_county.get(gid)
        assert props, f"{gid} expected generated county feature"
        assert props["region"] == region, f"{gid} expected {region}, saw {props['region']}"
        assert props["fill"] == fill, f"{gid} expected {fill}, saw {props['fill']}"

    dong_river = regions.get("Dong River Hakka")
    assert dong_river, "expected Dong River Hakka to be present"
    assert region_colors["Dong River Hakka"] == "#06f14f"

    prefecture_ids = set()
    for feature in data["prefectures"]["features"]:
        props = feature["properties"]
        assert feature["geometry"], f"{props.get('GID_2')} is missing geometry"
        assert props["level"] == 2
        assert props["GID_2"] not in prefecture_ids, f"duplicate prefecture {props['GID_2']}"
        prefecture_ids.add(props["GID_2"])



if __name__ == "__main__":
    main()
