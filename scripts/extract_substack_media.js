const childProcess = require("child_process");
const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const HTML_PATH = path.join(ROOT, "tmp_substack_article.html");
const MAP_DATA_PATH = path.join(ROOT, "assets", "map_data.json");
const IMAGES_DIR = path.join(ROOT, "assets", "images");
const OUT_PATH = path.join(ROOT, "assets", "article_media.json");
const SOURCE_URL = "https://chinesecookingdemystified.substack.com/p/63-chinese-cuisines-the-complete";
const staleFallbackImageRegions = new Set();

const headingAliases = {
  "Anhui North (and Anhui Central)": "Anhui North (and Anhui Central)",
  "Anhui South": "Anhui South",
  Beijing: "Beijing",
  Cantonese: "Cantonese",
  "Classical Huaiyang (plus Tucai)": "Classical Huaiyang (plus Tucai)",
  "Coastal (Qin-Lian-Lei-Qiong)": "Coastal (Qin-Lian-Lei-Qiong)",
  Dali: "Dali",
  "Dong River Hakka": "Dong River Hakka",
  "General Dongbei/Jilin Dongbei": "Jilin Dongbei",
  Guibei: "Guibei",
  Hakka: "Hakka",
  "Han Guizhou": "Han Guizhou",
  "Han Yunnan": "Han Yunnan",
  Hangzhou: "Hangzhou",
  Hebei: "Hebei",
  "Heilongjiang Dongbei": "Heilongjiang Dongbei",
  Henan: "Henan",
  Hlai: "Hlai",
  Honghe: "Honghe",
  Hubei: "Hubei",
  "Hong Kong Cantonese": "Hong Kong",
  "Hunan West": "Hunan West",
  Jiangxi: "Jiangxi",
  "Jiangsu North": "Jiangsu North",
  Jiaodong: "Jiaodong",
  Jinhua: "Jinhua",
  Joseon: "Joseon",
  "Lianzhou (Yao)": "Lianzhou Yao",
  "Liaoning Dongbei": "Liaoning Dongbei",
  "Lower River Gang": "Sichuan Lower River Gang",
  Lu: "Lu",
  ["Lu\u2019an"]: "Lu\u2019an",
  Minbei: "Minbei",
  Minnan: "Minnan",
  Nanjing: "Nanjing",
  "Nei Mongolia East": "Nei Mongolia East",
  "Nei Mongolia West": "Nei Mongolia West",
  "Inner Mongolia": ["Nei Mongolia East", "Nei Mongolia West"],
  Ningbo: "Ningbo",
  "Northeast Jiangxi Mountains": "Northeast Jiangxi Mountains",
  "Northwest Han-Hui": "Northwest Han-Hui",
  Ou: "Ou",
  ["Pu\u2019er-Sipsongpanna"]: "Pu\u2019er-Sipsongpanna",
  "Salt Gang": "Salt Gang",
  "Shaanxi Central": "Shaanxi Central",
  "Shaanxi North": "Shaanxi North",
  "Shaanxi South": "Shaanxi South",
  Shanghai: "Shanghai",
  Shanxi: "Shanxi",
  Shaoxing: "Shaoxing",
  She: "She",
  "South Guizhou": "South Guizhou",
  "Straits Chinese": "Straits Chinese",
  "Suzhou-Wuxi": "Suzhou-Wuxi",
  Taiwan: "Taiwan",
  "Fujian-Derived Taiwanese": "Fujian-Derived Taiwanese",
  "Non-Fujianese Taiwanese": "Non-Fujianese Taiwanese",
  Teochew: "Teochew",
  "The Tibetan Plateau": "The Tibetan Plateau",
  Tianjin: "Tianjin",
  "Upper River Gang": "Upper River Gang",
  "Han Xinjiang": "Han Xinjiang",
  "Uighur Xinjiang": "Uyghur Xinjiang",
  "West Fujian Mountains": "West Fujian Mountains",
  "West Yunnan": "West Yunnan",
  Xiang: "Xiang",
  "Yi Sichuan": "Yi Sichuan",
  "Yong-Yu River": "Yong-Yu River",
  "Zhuang Area": "Zhuang Area",
};

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&rsquo;/g, "\u2019")
    .replace(/&lsquo;/g, "\u2018")
    .replace(/&ldquo;/g, "\u201c")
    .replace(/&rdquo;/g, "\u201d");
}

function stripHtml(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function refreshArticleHtml() {
  childProcess.execFileSync("curl.exe", ["-L", SOURCE_URL, "-o", HTML_PATH], { stdio: "inherit" });
}

function loadPreloads() {
  refreshArticleHtml();
  const html = fs.readFileSync(HTML_PATH, "utf8");
  const start = html.indexOf("window._preloads");
  const parseStart = html.indexOf("JSON.parse(\"", start);
  const parseEnd = html.indexOf("\")</script>", parseStart);
  if (parseStart < 0 || parseEnd < 0) throw new Error("Could not find Substack preload JSON");
  const raw = html.slice(parseStart + "JSON.parse(\"".length, parseEnd);
  return JSON.parse(JSON.parse(`"${raw}"`));
}

function extractHeadings(body) {
  const headings = [];
  const pattern = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/g;
  let match;
  while ((match = pattern.exec(body))) {
    headings.push({
      tag: match[1],
      text: stripHtml(match[2]),
      index: match.index,
      end: pattern.lastIndex,
    });
  }
  return headings;
}

function nextSectionHeading(headings, heading) {
  return headings.find((candidate) => candidate.index > heading.index && /^h[34]$/.test(candidate.tag));
}

function extractGalleries(segment) {
  return [...segment.matchAll(/<div class="image-gallery-embed"[^>]+data-attrs="([^"]+)"/g)]
    .map((embed) => {
      const attrs = JSON.parse(decodeEntities(embed[1]));
      return (attrs.gallery?.images || [])
        .map((image) => image.src)
        .filter((src) => src && !/staticGalleryImage|favicon|twitter\.jpg/.test(src));
    })
    .filter((images) => images.length);
}

function extractGallery(segment, captions) {
  const galleries = extractGalleries(segment);
  return galleries.find((images) => captions.length && images.length === captions.length) || galleries[0] || [];
}

function cleanCaption(value) {
  const position = "(?:top|bottom)\\s+(?:left|middle|center|right)|(?:left|middle|center|right)";
  return String(value || "")
    .replace(new RegExp(`(?:^|[\\s.])(?:${position})(?=(?:[\\s.]|$))`, "gi"), (match) => (match.startsWith(".") ? "." : " "))
    .replace(/\s+\./g, ".")
    .replace(/\.{2,}/g, ".")
    .replace(/\s+/g, " ")
    .replace(/^\.\s*/, "")
    .replace(/\s*\.$/, ".")
    .trim();
}

function captionFromListItem(itemHtml) {
  const strong = cleanCaption(stripHtml((itemHtml.match(/<strong[^>]*>([\s\S]*?)<\/strong>/) || [null, ""])[1]));
  const em = cleanCaption(stripHtml((itemHtml.match(/<em[^>]*>([\s\S]*?)<\/em>/) || [null, ""])[1]));
  if (!strong && !em) return "";
  return [strong.replace(/\s+/g, " ").trim(), em.replace(/\s+/g, " ").trim()].filter(Boolean).join(" ");
}

function extractCaptions(segment) {
  const afterRepresentative = segment.split(/Representative dishes:/i)[1] || segment;
  return [...afterRepresentative.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((match) => captionFromListItem(match[1]));
}

function isMapLike(sectionText, images) {
  if (!images.length) return true;
  return /province|breakdown|location|map|outside of mainland china|other candidates/i.test(sectionText);
}

function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u2019/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function extensionFromUrl(url) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if (ext === ".jpeg") return ".jpg";
  if ([".jpg", ".png", ".webp"].includes(ext)) return ext;
  return ".jpg";
}

function cleanRegionFolder(folder) {
  fs.mkdirSync(folder, { recursive: true });
  for (const entry of fs.readdirSync(folder)) {
    if (/^img\d+\.(jpg|png|webp)$/i.test(entry)) {
      fs.unlinkSync(path.join(folder, entry));
    }
  }
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destination);
    const request = https.get(url, { rejectUnauthorized: false }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlink(destination, () => {});
        downloadFile(new URL(response.headers.location, url).toString(), destination).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        file.close();
        fs.unlink(destination, () => {});
        reject(new Error(`Download failed ${response.statusCode}: ${url}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
    });
    request.on("error", (error) => {
      file.close();
      fs.unlink(destination, () => {});
      reject(error);
    });
  });
}

function extractMediaByRegion() {
  const body = loadPreloads().post.body_html;
  const headings = extractHeadings(body);
  const media = {};

  for (const heading of headings) {
    const regions = headingAliases[heading.text];
    if (!regions) continue;
    const next = nextSectionHeading(headings, heading);
    const segment = body.slice(heading.end, next ? next.index : body.length);
    const captions = extractCaptions(segment);
    const images = extractGallery(segment, captions);
    if (isMapLike(heading.text, images)) continue;
    for (const region of Array.isArray(regions) ? regions : [regions]) {
      media[region] = {
        source: SOURCE_URL,
        images: images.map((src, index) => ({
          src,
          caption: captions[index] || "",
        })),
      };
    }
  }

  return media;
}

async function downloadMedia(media) {
  for (const [region, item] of Object.entries(media)) {
    const slug = slugify(region);
    const folder = path.join(IMAGES_DIR, slug);
    cleanRegionFolder(folder);
    for (let index = 0; index < item.images.length; index += 1) {
      const image = item.images[index];
      const ext = extensionFromUrl(image.src);
      const relativePath = `assets/images/${slug}/img${index + 1}${ext}`;
      const destination = path.join(ROOT, relativePath);
      await downloadFile(image.src, destination);
      image.originalSrc = image.src;
      image.src = relativePath.replace(/\\/g, "/");
    }
  }
}

function cleanStaleFallbackFolders() {
  for (const region of staleFallbackImageRegions) {
    const folder = path.join(IMAGES_DIR, slugify(region));
    if (!fs.existsSync(folder)) continue;
    cleanRegionFolder(folder);
  }
}

function cloneMediaEntry(name, source, images) {
  return {
    source,
    images: images.map((image) => ({
      src: image.src,
      caption: image.caption,
      ...(image.group ? { group: image.group } : {}),
    })),
  };
}

function addCombinedMedia(media, name, sectionNames) {
  const sections = sectionNames.map((sectionName) => media[sectionName]).filter(Boolean);
  const images = sections.flatMap((section, index) => {
    const group = sectionNames[index];
    return (section.images || []).map((image) => ({ ...image, group }));
  });
  if (!images.length) return;
  media[name] = cloneMediaEntry(name, SOURCE_URL, images);
}

function addSyntheticMapMedia(media) {
  addCombinedMedia(media, "Taiwan", ["Fujian-Derived Taiwanese", "Non-Fujianese Taiwanese"]);
  addCombinedMedia(media, "Xinjiang", ["Han Xinjiang", "Uyghur Xinjiang"]);
}

function mergeIntoMapData(media) {
  const mapData = JSON.parse(fs.readFileSync(MAP_DATA_PATH, "utf8"));
  for (const feature of Object.values(mapData.features)) {
    if (staleFallbackImageRegions.has(feature.name)) {
      feature.images = [];
      delete feature.source;
    }
    const item = media[feature.name];
    if (!item) continue;
    feature.images = item.images;
    feature.source = item.source;
  }
  fs.writeFileSync(MAP_DATA_PATH, `${JSON.stringify(mapData, null, 2)}\n`, "utf8");
}

async function main() {
  const media = extractMediaByRegion();
  addSyntheticMapMedia(media);
  await downloadMedia(media);
  cleanStaleFallbackFolders();
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(media, null, 2)}\n`, "utf8");
  mergeIntoMapData(media);
  fs.rmSync(HTML_PATH, { force: true });

  const coverage = Object.fromEntries(Object.entries(media).map(([name, item]) => [name, item.images.length]));
  console.log(JSON.stringify({ regions: Object.keys(media).length, coverage }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
