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
  `function parseUpcomingInfo(text) {
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
  /result\.explicitlySoldOut =\n      lower\.includes\("sold out"\) \|\|\n      lower\.includes\("out of stock"\) \|\|\n      lower\.includes\("unavailable"\);\n\n    if \(checkLaunch\) \{\n      result\.launchDate =\n        parseLaunchDate\(html\);\n\n      result\.upcoming =\n        Boolean\(\n          result\.launchDate\n        \);\n    \}/,
  `result.explicitlySoldOut =
      lower.includes("sold out") ||
      lower.includes("out of stock");

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

replaceRequired(
  "new product upcoming alert key",
  /record\.upcomingAlertSent\s*=\s*true;/,
  `record.upcomingAlertSent = true;

            record.upcomingAlertKey =
              product.handle +
              "|" +
              (product.launchDate || "PREORDER");`
);

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
  "live inventory verification",
  /const available =\s*getAvailable\(raw\);/,
  `let available = getAvailable(raw);
      let liveInventoryVerified = false;
      let liveQuantity = null;
      let liveVariantId = null;

      // Verify Shopify stock before emitting stock transitions. On request
      // failure, preserve the last known state rather than invent a transition.
      if (raw.handle && (available || previousAvailable === true)) {
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
              if (variant?.available !== true) return false;
              const quantity = variant?.inventory_quantity;
              return quantity === null || quantity === undefined ||
                !Number.isFinite(Number(quantity)) || Number(quantity) > 0;
            });

            liveInventoryVerified = true;
            available = purchasableVariants.length > 0;
            liveVariantId = purchasableVariants.find(variant => variant?.id)?.id || null;

            const knownQuantities = variants
              .map(variant => variant?.inventory_quantity)
              .filter(quantity => quantity !== null && quantity !== undefined && Number.isFinite(Number(quantity)));
            liveQuantity = knownQuantities.length
              ? knownQuantities.reduce((sum, quantity) => sum + Math.max(0, Number(quantity)), 0)
              : null;
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
replaceRequired(
  "new product live verification guard",
  /} else if \(\s*product\.available\s*\) \{/,
  `} else if (
            product.available &&
            product.liveInventoryVerified === true
          ) {`
);

replaceRequired(
  "upcoming transition alert",
  /        \/\/ =========================\n        \/\/ RESTOCK\n        \/\/ =========================/,
  `        // =========================
        // UPCOMING / PRE-ORDER TRANSITION
        // =========================

        const upcomingAlertKey =
          product.handle +
          "|" +
          (product.launchDate || "PREORDER");

        if (
          product.upcoming === true &&
          previousLastScanAt &&
          record.upcomingAlertKey !== upcomingAlertKey
        ) {
          record.upcomingAlertSent = true;
          record.upcomingAlertKey = upcomingAlertKey;

          addAlert(
            alerts,
            \`🚀 \${product.title}\`
          );

          await sendToChannel(
            channel,
            makeEmbed(
              "🚀 UPCOMING / PRE-ORDER",
              0xffa500,
              product,
              [
                {
                  name: "📦 Product",
                  value: product.title
                },
                {
                  name: "🚀 Release / Ship Date",
                  value: product.launchDate || "Pre-order / Coming Soon",
                  inline: true
                },
                {
                  name: "💲 Price",
                  value: \`$\${product.price || "Unknown"}\`,
                  inline: true
                }
              ]
            )
          );
        }

        // =========================
        // RESTOCK
        // =========================
        // =========================
        // RESTOCK
        // =========================`
);

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
  "catalog timeout",
  /await fetch\(url, \{\n        headers: \{\n          "User-Agent":\n            "Mozilla\/5\.0 MattelBotV2"\n        \}\n      \}\);/,
  `await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 MattelBotV2"
        },
        signal: AbortSignal.timeout(15000)
      });`
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
console.log("[PRODUCTION-FIX] Smart Discovery Upcoming engine applied");
console.log("[PRODUCTION-FIX] Starting bot.js");

eval(source);
