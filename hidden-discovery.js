// Discover source-only Mattel vehicle pages that are not returned by products.json.
// This supplements (does not replace) the regular catalog/restock scanner.
const BASE = "https://creations.mattel.com";
const SOURCES = [
  "/pages/launch-calendar",
  "/collections/hot-wheels",
  "/collections/red-line-club",
  "/collections/elite-64",
  "/collections/matchbox",
  "/collections/new-arrivals"
];
const BLOCKED = [
  "shirt", "t-shirt", "hoodie", "sweatshirt", "sweater", "jacket",
  "crewneck", "pullover", "jersey", "hat", "beanie", "mug", "tumbler",
  "cup", "drinkware", "blanket", "sticker", "pin", "keychain", "poster",
  "tote", "backpack", "bag", "pants", "glass", "luggage", "tag", "barbie",
  "formula-1-team"
];
const VEHICLE = [
  "hot-wheels", "hot wheels", "matchbox", "rlc", "red-line", "elite-64",
  "boulevard", "team-transport", "car-culture", "skyline", "mustang",
  "porsche", "ferrari", "nissan", "datsun", "chevrolet", "chevy", "dodge",
  "ford", "toyota", "mazda", "blazer", "silverado", "240z", "240-z"
];
const text = value => String(value || "").replace(/\\s+/g, " ").trim();
const lower = value => text(value).toLowerCase();

async function getText(url) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 MattelBotV2 HiddenDiscovery" },
      signal: AbortSignal.timeout(12000)
    });
    return response.ok ? await response.text() : null;
  } catch {
    return null;
  }
}

async function getJson(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 MattelBotV2 HiddenDiscovery" },
      signal: AbortSignal.timeout(8000)
    });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function isVehicle(handle, title = "") {
  const value = lower(handle + " " + title);
  if (!value || BLOCKED.some(term => value.includes(term))) return false;
  if (/(?:2018|2019|2020|2021|2022|2023|2024)/i.test(handle)) return false;
  return VEHICLE.some(term => value.includes(term));
}

function parseTitle(html, handle) {
  const match = html.match(/property=["']og:title["']\\s+content=["']([^"']+)/i)
    || html.match(/<title[^>]*>([^<]+)/i);
  return text(match?.[1] || handle).replace(/\\s*\\|\\s*Mattel.*$/i, "");
}

function hasLaunchOrHiddenSignal(html) {
  return /\\bLaunches\\s+[A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}/i.test(html)
    || /\\b(?:ships|expected to ship|shipping by)\\s+[A-Za-z0-9\\s,]+/i.test(html)
    || /add-to-cart|add to cart|product-form/i.test(html);
}

async function runHiddenDiscovery({ catalog, savedProducts, channel, stats, alerts, addAlert, makeEmbed, productUrl }) {
  const startedAt = Date.now();
  const catalogHandles = new Set((catalog || []).map(p => lower(p?.handle)).filter(Boolean));
  const savedHandles = new Set(Object.values(savedProducts || {}).map(p => lower(p?.handle)).filter(Boolean));
  const candidates = new Set();

  const pages = await Promise.all(SOURCES.map(path => getText(BASE + path)));
  for (const html of pages) {
    if (!html) continue;
    const pattern = /\\/products\\/([a-z0-9][a-z0-9-]{1,150})(?:[?#"'\\\\/]|$)/gi;
    let match;
    while ((match = pattern.exec(html))) {
      const handle = lower(match[1]);
      if (!catalogHandles.has(handle) && !savedHandles.has(handle) && isVehicle(handle)) {
        candidates.add(handle);
      }
    }
  }

  // Keep the scan bounded and concurrent; the ordinary catalog scanner still owns
  // known products, restocks, and sold-out transitions.
  const handles = [...candidates].slice(0, 40);
  let discovered = 0;

  for (let i = 0; i < handles.length; i += 5) {
    const batch = handles.slice(i, i + 5);
    const results = await Promise.all(batch.map(async handle => {
      const html = await getText(productUrl(handle));
      if (!html || /Page not found|404 Not Found/i.test(html)) return null;
      const title = parseTitle(html, handle);
      if (!isVehicle(handle, title)) return null;
      const page = lower(html);
      if (/sold[ -]?out|out of stock/i.test(page)) return null;
      if (!hasLaunchOrHiddenSignal(html)) return null;

      // A live purchasable item belongs to the regular new/restock path.
      const live = await getJson(BASE + "/products/" + handle + ".js");
      if (live && Array.isArray(live.variants) && live.variants.some(v => v?.available === true)) return null;

      return { handle, title, html };
    }));

    for (const product of results.filter(Boolean)) {
      const handle = product.handle;
      stats.hiddenAlertedHandles = Array.isArray(stats.hiddenAlertedHandles) ? stats.hiddenAlertedHandles : [];
      if (stats.hiddenAlertedHandles.includes(handle)) continue;

      const titleMatch = product.html.match(/property=["']og:title["']\\s+content=["']([^"']+)/i);
      const priceMatch = product.html.match(/["']price["']\\s*:\\s*["']?([0-9]+(?:\\.[0-9]{1,2})?)/i);
      const price = priceMatch ? "$" + priceMatch[1] : "Unknown";
      const url = productUrl(handle);
      const embed = makeEmbed("👻 POSSIBLE HIDDEN PRODUCT DETECTED", 0xffcc00, {
        title: product.title,
        handle,
        url
      }, [
        { name: "📦 Product", value: product.title },
        { name: "👀 Status", value: "NOT AVAILABLE YET", inline: true },
        { name: "💲 Price", value: price, inline: true },
        { name: "🔎 Discovery", value: "Found on Mattel collection/source page; not in the regular product catalog." }
      ]);

      // Persist the dedupe key before sending so a restart cannot immediately
      // resend the same discovery on the next scan.
      stats.hiddenAlertedHandles.push(handle);
      stats.hiddenAlertedHandles = stats.hiddenAlertedHandles.slice(-1000);
      addAlert(alerts, "👻 " + product.title);
      await channel.send({ embeds: [embed] });
      discovered++;
    }
  }

  console.log("[HIDDEN] Source-only scan checked " + handles.length + " candidates; sent " + discovered + " new hidden alerts in " + Math.round((Date.now() - startedAt) / 1000) + "s.");
  return discovered;
}

module.exports = { runHiddenDiscovery };
