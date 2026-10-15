// Production launcher for MattelBotV2.
// Applies the production fixes directly to bot.js, then starts the bot.
// This keeps bot.js as the main scanner while avoiding the old patch order
// that allowed stale launch/pre-order text to become "upcoming".

const fs = require("fs");
const path = require("path");

const botPath = path.join(__dirname, "bot.js");
let source = fs.readFileSync(botPath, "utf8");

function replaceRequired(label, pattern, replacement) {
  const next = source.replace(pattern, replacement);
  if (next === source) {
    throw new Error(`[PRODUCTION-FIX] Could not patch ${label}.`);
  }
  source = next;
}

// 1) Correct upcoming/pre-order detection.
// A launch/ship date is only upcoming when the date is in the future.
// "Pre-order" / "Coming Soon" is ignored when the page is explicitly sold out.
replaceRequired(
  "launch parser",
  /function parseLaunchDate\(text\) \{[\s\S]*?\n\}\n\n\/\/ =========================\n\/\/ MATTEL PRODUCT CATALOG/,
  String.raw`function parseUpcomingInfo(text) {
  if (!text) {
    return {
      upcoming: false,
      launchDate: null
    };
  }

  const source = String(text);

  const parseFutureDate = value => {
    if (!value) {
      return false;
    }

    const match = String(value).match(
      /([A-Za-z]+\s+\d{1,2},\s+\d{4})/
    );

    if (!match) {
      return false;
    }

    const launchDay = Date.parse(
      match[1] + " UTC"
    );

    const todayPTText =
      new Intl.DateTimeFormat(
        "en-US",
        {
          timeZone: "America/Los_Angeles",
          year: "numeric",
          month: "long",
          day: "numeric"
        }
      ).format(new Date());

    const todayPT =
      Date.parse(
        todayPTText + " UTC"
      );

    return (
      Number.isFinite(launchDay) &&
      Number.isFinite(todayPT) &&
      launchDay >= todayPT
    );
  };

  const launchMatch = source.match(
    /Launches\s+([A-Za-z]+\s+\d{1,2},\s+\d{4}(?:\s+\d{1,2}:\d{2}\s*(?:am|pm)\s*PT)?)/i
  );

  if (launchMatch) {
    return {
      upcoming: parseFutureDate(launchMatch[1]),
      launchDate: launchMatch[1]
    };
  }

  const shipMatch = source.match(
    /Ships\s+(?:on\s+or\s+before|on)\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
  );

  if (shipMatch) {
    return {
      upcoming: parseFutureDate(shipMatch[1]),
      launchDate: shipMatch[1]
    };
  }

  if (/\bpre[-\s]?order\b/i.test(source)) {
    return {
      upcoming: true,
      launchDate: null
    };
  }

  if (/\bcoming\s+soon\b/i.test(source)) {
    return {
      upcoming: true,
      launchDate: null
    };
  }

  return {
    upcoming: false,
    launchDate: null
  };
}

// =========================
// MATTEL PRODUCT CATALOG`
);


replaceRequired(
  "upcoming sold-out guard",
  /result\.explicitlySoldOut =\s*[\s\S]*?if \(checkLaunch\) \{[\s\S]*?\n    \}/,
  `result.explicitlySoldOut =
      /\\bsold[ -]?out\\b/i.test(lower) ||
      /\\bout of stock\\b/i.test(lower) ||
      /\\bcurrently unavailable\\b/i.test(lower);

    if (checkLaunch) {
      const upcomingInfo =
        parseUpcomingInfo(html);

      result.launchDate =
        upcomingInfo.launchDate;

      result.upcoming =
        !result.explicitlySoldOut &&
        upcomingInfo.upcoming;
    }`
);

// upcoming-discovery.js owns both the upcoming notification and its persisted alert key.
// Do not patch bot.js for this; that path no longer sends upcoming alerts.

replaceRequired(
  "previous upcoming state",
  /const previousHiddenAlertSent =\n        existing\n          \? existing\.hiddenAlertSent === true\n          : false;\n\n      const available =/,
  `const previousHiddenAlertSent =
        existing
          ? existing.hiddenAlertSent === true
          : false;

      const previousUpcoming =
        existing
          ? existing.upcoming === true
          : false;

      const previousUpcomingAlertKey =
        existing?.upcomingAlertKey || null;

      const available =`
);


replaceRequired(
  "bounded sold-out inventory audit",
  /const processed = \[\];/,
  `const processed = [];

    // Audit a small rotating batch of tracked sold-out items each scan.
    // This catches catalog-stale restocks without hammering every Mattel product endpoint.
    const soldOutAuditCandidates = candidates
      .filter(raw =>
        raw?.handle &&
        savedProducts[String(raw.id)]?.available === false
      )
      .sort((a, b) =>
        String(a.handle).localeCompare(String(b.handle))
      );

    const restockAuditBatchSize = 10;
    const restockAuditCursor = Number.isFinite(Number(stats.restockAuditCursor))
      ? Math.max(0, Number(stats.restockAuditCursor))
      : 0;
    const restockAuditHandles = new Set();
    const auditCount = Math.min(restockAuditBatchSize, soldOutAuditCandidates.length);
    const auditStart = soldOutAuditCandidates.length
      ? restockAuditCursor % soldOutAuditCandidates.length
      : 0;

    for (let i = 0; i < auditCount; i++) {
      const audited = soldOutAuditCandidates[
        (auditStart + i) % soldOutAuditCandidates.length
      ];
      restockAuditHandles.add(audited.handle);
    }

    stats.restockAuditCursor = soldOutAuditCandidates.length
      ? (auditStart + auditCount) % soldOutAuditCandidates.length
      : 0;
`
);

replaceRequired(
  "live inventory verification",
  /const available =\s*getAvailable\(raw\);/,
  `let available = getAvailable(raw);
      let liveInventoryVerified = false;
      let liveQuantity = null;
      let liveVariantId = null;

      // Verify Shopify stock before emitting stock transitions. On request
      // failure, preserve the last known state rather than invent a transition.
      if (raw.handle && (available === true || previousAvailable === true || restockAuditHandles.has(raw.handle))) {
        try {
          const liveResponse = await fetch(
            "https://creations.mattel.com/products/" + raw.handle + ".js",
            {
              headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 MattelBotV2" },
              signal: AbortSignal.timeout(8000)
            }
          );

          if (liveResponse.ok) {
            const liveProduct = await liveResponse.json();
            const variants = Array.isArray(liveProduct?.variants) ? liveProduct.variants : [];
            const purchasableVariants = variants.filter(variant => {
              // Shopify `available` is the purchaseability signal. Inventory quantity
              // can legitimately be zero for backorder/continue-selling variants.
              return variant?.available === true;
            });

            if (variants.length > 0) {
              // Empty variants are an unverified response, not proof of sold-out inventory.
              liveInventoryVerified = true;
              available = purchasableVariants.length > 0;
              liveVariantId = purchasableVariants.find(variant => variant?.id)?.id || null;

              const knownQuantities = variants
                .map(variant => variant?.inventory_quantity)
                .filter(quantity => quantity !== null && quantity !== undefined && Number.isFinite(Number(quantity)));
              liveQuantity = knownQuantities.length
                ? knownQuantities.reduce((sum, quantity) => sum + Math.max(0, Number(quantity)), 0)
                : null;
              console.log("[LIVE INVENTORY] " + raw.handle + ": " + (available ? "PURCHASABLE" : "NOT PURCHASABLE") + " (qty: " + (liveQuantity ?? "unknown") + ")");
            } else {
              available = previousAvailable === null ? getAvailable(raw) : previousAvailable;
              console.log("[LIVE INVENTORY] " + raw.handle + ": UNVERIFIED (empty variants; preserving prior state)");
            }
          } else {
            available = previousAvailable === null ? false : previousAvailable;
          }
        } catch {
          available = previousAvailable === null ? false : previousAvailable;
        }
      }`
);
replaceRequired(
  "live variant selection",
  /variantId:\s*getVariantId\(raw\),/,
  `variantId: liveVariantId || getVariantId(raw),
        liveInventoryVerified,
        liveQuantity,`
);
replaceRequired(
  "restock live verification guard",
  /previousAvailable === false &&\s*product\.available === true/,
  `previousAvailable === false &&
          product.available === true &&
          product.liveInventoryVerified === true`
);
replaceRequired(
  "sold-out live verification guard",
  /previousAvailable === true &&\s*product\.available === false/,
  `previousAvailable === true &&
          product.available === false &&
          product.liveInventoryVerified === true`
);
// bot.js now checks liveInventoryVerified directly in its new-product branch.
// Do not patch that branch again here; doing so would fail after the source change.

// Upcoming launch notifications are owned by upcoming-discovery.js only.
// Do not inject a second upcoming transition alert into bot.js.

source = source.replace(
  /(!product\.explicitlySoldOut\s*&&\s*)!product\.launchDate/g,
  `$1!product.upcoming &&\n          !product.launchDate`
);

replaceRequired(
  "variant selection",
  /function getVariantId\(product\) \{\n  return \(\n    product\?\.variants\?\.\[0\]\?\.id \|\|\n    null\n  \);\n\}/,
  `function getVariantId(product) {
  const variants =
    Array.isArray(product?.variants)
      ? product.variants
      : [];

  const availableVariant =
    variants.find(
      variant =>
        variant?.available === true &&
        variant?.id
    );

  return (
    availableVariant?.id ||
    variants.find(variant => variant?.id)?.id ||
    null
  );
}`
);

replaceRequired(
  "cart buttons",
  /function cartRow\(variantId\)\s*\{[\s\S]*?\}\s*async function sendToChannel/,
  `function cartRow(variantId) {
  if (!variantId) {
    return null;
  }

  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel("🛒 QTY 2")
        .setStyle(ButtonStyle.Link)
        .setURL(\`https://creations.mattel.com/cart/\${variantId}:2\`),
      new ButtonBuilder()
        .setLabel("🛒 QTY 10")
        .setStyle(ButtonStyle.Link)
        .setURL(\`https://creations.mattel.com/cart/\${variantId}:10\`),
      new ButtonBuilder()
        .setLabel("🛒 QTY 20")
        .setStyle(ButtonStyle.Link)
        .setURL(\`https://creations.mattel.com/cart/\${variantId}:20\`),
      new ButtonBuilder()
        .setLabel("🛒 QTY 50")
        .setStyle(ButtonStyle.Link)
        .setURL(\`https://creations.mattel.com/cart/\${variantId}:50\`)
    );
}

async function sendToChannel`
);

replaceRequired(
  "product fallback button",
  /async function sendToChannel\([\s\S]*?\}\s*function addAlert/,
  `async function sendToChannel(
  channel,
  embed,
  row = null
) {
  const payload = {
    embeds: [embed]
  };

  const effectiveRow =
    row ||
    (embed?.data?.url
      ? new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setLabel("🔗 VIEW PRODUCT")
              .setStyle(ButtonStyle.Link)
              .setURL(embed.data.url)
          )
      : null);

  if (effectiveRow) {
    payload.components = [effectiveRow];
  }

  await channel.send(payload);
}

function addAlert`
);

replaceRequired(
  "catalog retry and pacing",
  /async function getMattelProducts\(\) \{[\s\S]*?\n\}\n\n\/\/ =========================\n\/\/ PRODUCT PAGE CHECK/,
  String.raw`async function getMattelProducts() {
  const products = [];
  const seen = new Set();
  let page = 1;

  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  while (true) {
    const url =
      "https://creations.mattel.com/products.json?limit=250&page=" + page;
    let response = null;
    let lastError = null;

    // Mattel occasionally rate-limits catalog requests. Honor Retry-After,
    // back off on 429/5xx/network failures, and never treat a failed page as empty.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        response = await fetch(url, {
          headers: {
            "Accept": "application/json",
            "User-Agent": "Mozilla/5.0 MattelBotV2"
          },
          signal: AbortSignal.timeout(15000)
        });

        if (response.ok) {
          break;
        }

        const status = response.status;
        if (status !== 429 && status < 500) {
          throw new Error("Mattel catalog HTTP " + status + " (not retryable)");
        }

        lastError = new Error("Mattel catalog HTTP " + status);
        if (attempt === 3) break;

        const retryAfter = response.headers?.get("retry-after");
        let delayMs = 2000 * Math.pow(2, attempt);
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const retryDate = Date.parse(retryAfter);
          if (Number.isFinite(seconds) && seconds >= 0) {
            delayMs = seconds * 1000;
          } else if (Number.isFinite(retryDate)) {
            delayMs = Math.max(0, retryDate - Date.now());
          }
        }
        delayMs = retryAfter ? Math.max(1000, delayMs) : Math.min(30000, Math.max(1000, delayMs));
        console.warn("[CATALOG] HTTP " + status + " on page " + page +
          "; retry " + (attempt + 1) + "/3 in " + delayMs + "ms");
        await wait(delayMs);
        response = null;
      } catch (error) {
        if (error?.message?.includes("(not retryable)")) throw error;
        lastError = error;
        if (attempt === 3) break;
        const delayMs = Math.min(30000, 2000 * Math.pow(2, attempt));
        console.warn("[CATALOG] Request failed on page " + page +
          "; retry " + (attempt + 1) + "/3 in " + delayMs + "ms: " +
          (error?.message || error));
        await wait(delayMs);
        response = null;
      }
    }

    if (!response?.ok) {
      throw new Error(
        "Mattel catalog page " + page + " failed after 4 attempts: " +
        (lastError?.message || "no successful response")
      );
    }

    const data = await response.json();
    const batch = Array.isArray(data?.products) ? data.products : [];

    if (!batch.length) break;

    for (const product of batch) {
      const id = String(product?.id || "");
      if (id && !seen.has(id)) {
        seen.add(id);
        products.push(product);
      }
    }

    console.log("📄 Mattel catalog page " + page + ": " + batch.length + " products");
    if (batch.length < 250) break;

    page++;
    // Avoid hammering the catalog while walking multiple pages.
    await wait(1200);
  }

  console.log("📦 Mattel catalog total: " + products.length);
  return products;
}

// =========================
// PRODUCT PAGE CHECK`
);
replaceRequired(
  "product timeout",
  /await fetch\(\n        productUrl\(handle\),\n        \{\n          headers: \{\n            "User-Agent":\n              "Mozilla\/5\.0 MattelBotV2"\n          \}\n        \}\n      \);/,
  `await fetch(
        productUrl(handle),
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 MattelBotV2"
          },
          signal: AbortSignal.timeout(15000)
        }
      );`
);

replaceRequired(
  "scanner startup order",
  /startDailySummary\(\);\n\n    await scanForNewProducts\(\);\n\n    startScanner\(\);/,
  `startDailySummary();

    startScanner();

    await scanForNewProducts();`
);

replaceRequired(
  "hidden source discovery before long catalog processing",
  /    const processed = \[\];/,
  `    // Run the bounded hidden-source pass before the full per-product loop.
    // This ensures hidden discoveries can alert even if a later scan is interrupted.
    await require("./hidden-discovery").runHiddenDiscovery({
      catalog,
      savedProducts,
      channel,
      stats,
      saveStats,
      alerts,
      addAlert,
      makeEmbed,
      productUrl
    });

    const processed = [];`
);

replaceRequired(
  "smart upcoming discovery integration",
  /    saveProducts\(\n      savedProducts\n    \);/,
  `    await require("./upcoming-discovery").runSmartUpcomingDiscovery({
      catalog,
      savedProducts,
      channel,
      stats,
      alerts,
      addAlert,
      makeEmbed,
      productUrl
    });

    saveProducts(
      savedProducts
    );`
);

source = source.replace(
  /client\.once\(\s*"ready"\s*,/g,
  'client.once("clientReady",'
);

console.log("[PRODUCTION-FIX] Upcoming date validation applied");
console.log("[PRODUCTION-FIX] Direct Shopify cart/product buttons applied");
console.log("[PRODUCTION-FIX] Scanner timeout + scheduler fixes applied");
console.log("[PRODUCTION-FIX] Hidden source discovery engine applied");
console.log("[PRODUCTION-FIX] Smart Discovery Upcoming engine applied");
console.log("[PRODUCTION-FIX] Starting bot.js");

eval(source);
