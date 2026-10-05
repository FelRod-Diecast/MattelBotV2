// Runtime availability/upcoming patch for MattelBotV2.
// Keeps the existing bot logic intact while applying the current
// preorder/ship-date detection fix, Discord cart links, and scanner
// reliability improvements before bot.js starts.

const fs = require("fs");
const path = require("path");

const botPath = path.join(__dirname, "bot.js");
let source = fs.readFileSync(botPath, "utf8");

const oldParser = `function parseLaunchDate(text) {
  if (!text) {
    return null;
  }

  const match =
    String(text).match(
      /Launches\\s+([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}\\s+\\d{1,2}:\\d{2}\\s*(?:am|pm)\\s*PT)/i
    );

  return match
    ? match[1]
    : null;
}`;

const newParser = `function parseUpcomingInfo(text) {
  if (!text) {
    return {
      upcoming: false,
      launchDate: null
    };
  }

  const source = String(text);

  const launchMatch = source.match(
    /Launches\\s+([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4}(?:\\s+\\d{1,2}:\\d{2}\\s*(?:am|pm)\\s*PT)?)/i
  );

  if (launchMatch) {
    return {
      upcoming: true,
      launchDate: launchMatch[1]
    };
  }

  const shipMatch = source.match(
    /Ships\\s+(?:on\\s+or\\s+before|on)\\s+([A-Za-z]+\\s+\\d{1,2},\\s+\\d{4})/i
  );

  if (shipMatch) {
    return {
      upcoming: true,
      launchDate: shipMatch[1]
    };
  }

  if (/\\bpre[-\\s]?order\\b/i.test(source)) {
    return {
      upcoming: true,
      launchDate: null
    };
  }

  if (/\\bcoming\\s+soon\\b/i.test(source)) {
    return {
      upcoming: true,
      launchDate: null
    };
  }

  return {
    upcoming: false,
    launchDate: null
  };
}`;

if (!source.includes(oldParser)) {
  throw new Error("Availability patch stopped: parseLaunchDate block not found.");
}
source = source.replace(oldParser, newParser);

const oldSoldOut = `    result.explicitlySoldOut =
      lower.includes("sold out") ||
      lower.includes("out of stock") ||
      lower.includes("unavailable");`;
const newSoldOut = `    result.explicitlySoldOut =
      lower.includes("sold out") ||
      lower.includes("out of stock");`;

if (!source.includes(oldSoldOut)) {
  throw new Error("Availability patch stopped: sold-out block not found.");
}
source = source.replace(oldSoldOut, newSoldOut);

const oldLaunchCheck = `    if (checkLaunch) {
      result.launchDate =
        parseLaunchDate(html);

      result.upcoming =
        Boolean(
          result.launchDate
        );
    }`;
const newLaunchCheck = `    if (checkLaunch) {
      const upcomingInfo =
        parseUpcomingInfo(html);

      result.launchDate =
        upcomingInfo.launchDate;

      result.upcoming =
        upcomingInfo.upcoming;
    }`;

if (!source.includes(oldLaunchCheck)) {
  throw new Error("Availability patch stopped: launch check block not found.");
}
source = source.replace(oldLaunchCheck, newLaunchCheck);

const oldPageFetch = `          await fetchProductPageInfo(
            raw.handle,
            shouldCheckLaunch
          );`;
const newPageFetch = `          await fetchProductPageInfo(
            raw.handle,
            true
          );`;

if (!source.includes(oldPageFetch)) {
  throw new Error("Availability patch stopped: product-page fetch call not found.");
}
source = source.replace(oldPageFetch, newPageFetch);

const oldPreviousState = `      const previousHiddenAlertSent =
        existing
          ? existing.hiddenAlertSent === true
          : false;

      const available =`;
const newPreviousState = `      const previousHiddenAlertSent =
        existing
          ? existing.hiddenAlertSent === true
          : false;

      const previousUpcoming =
        existing
          ? existing.upcoming === true
          : false;

      const available =`;

if (!source.includes(oldPreviousState)) {
  throw new Error("Availability patch stopped: previous-state anchor not found.");
}
source = source.replace(oldPreviousState, newPreviousState);

const restockAnchor = `        // =========================
        // RESTOCK
        // =========================

        if (
          previousAvailable === false &&
          product.available === true`;

const upcomingTransition = `        // =========================
        // UPCOMING / PRE-ORDER TRANSITION
        // =========================

        if (
          previousUpcoming === false &&
          product.upcoming === true &&
          !record.upcomingAlertSent &&
          previousLastScanAt
        ) {
          record.upcomingAlertSent = true;

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

${restockAnchor}`;

if (!source.includes(restockAnchor)) {
  throw new Error("Availability patch stopped: restock anchor not found.");
}
source = source.replace(restockAnchor, upcomingTransition);

// Do not classify a known preorder/coming-soon product as a hidden opportunity.
source = source.replace(
  `          !product.explicitlySoldOut &&
          !product.launchDate`,
  `          !product.explicitlySoldOut &&
          !product.upcoming &&
          !product.launchDate`
);

source = source.replace(
  `            !product.explicitlySoldOut &&
            !product.launchDate`,
  `            !product.explicitlySoldOut &&
            !product.upcoming &&
            !product.launchDate`
);

// =========================
// DISCORD CART / PRODUCT LINKS
// =========================

const oldVariantHelper = `function getVariantId(product) {
  return (
    product?.variants?.[0]?.id ||
    null
  );
}`;

const newVariantHelper = `function getVariantId(product) {
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
}`;

if (!source.includes(oldVariantHelper)) {
  throw new Error("Discord patch stopped: getVariantId block not found.");
}
source = source.replace(oldVariantHelper, newVariantHelper);

const oldCartRow = `function cartRow(variantId) {
  if (!variantId) {
    return null;
  }

  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setLabel("🛒 View Product")
        .setStyle(
          ButtonStyle.Link
        )
        .setURL(
          "https://creations.mattel.com/"
        )
    );
}`;

const newCartRow = `function cartRow(variantId) {
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
}`;

if (!source.includes(oldCartRow)) {
  throw new Error("Discord patch stopped: cartRow block not found.");
}
source = source.replace(oldCartRow, newCartRow);

const oldSendToChannel = `async function sendToChannel(
  channel,
  embed,
  row = null
) {
  const payload = {
    embeds: [embed]
  };

  if (row) {
    payload.components = [row];
  }

  await channel.send(
    payload
  );
}`;

const newSendToChannel = `async function sendToChannel(
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

  await channel.send(
    payload
  );
}`;

if (!source.includes(oldSendToChannel)) {
  throw new Error("Discord patch stopped: sendToChannel block not found.");
}
source = source.replace(oldSendToChannel, newSendToChannel);

// =========================
// SCANNER RELIABILITY
// =========================

const oldCatalogFetch = `      await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 MattelBotV2"
        }
      });`;
const newCatalogFetch = `      await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 MattelBotV2"
        },
        signal: AbortSignal.timeout(15000)
      });`;

if (!source.includes(oldCatalogFetch)) {
  throw new Error("Scanner patch stopped: catalog fetch block not found.");
}
source = source.replace(oldCatalogFetch, newCatalogFetch);

const oldProductFetch = `      await fetch(
        productUrl(handle),
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 MattelBotV2"
          }
        }
      );`;
const newProductFetch = `      await fetch(
        productUrl(handle),
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 MattelBotV2"
          },
          signal: AbortSignal.timeout(15000)
        }
      );`;

if (!source.includes(oldProductFetch)) {
  throw new Error("Scanner patch stopped: product-page fetch block not found.");
}
source = source.replace(oldProductFetch, newProductFetch);

const oldReady = `    startDailySummary();

    await scanForNewProducts();

    startScanner();`;
const newReady = `    startDailySummary();

    startScanner();

    await scanForNewProducts();`;

if (!source.includes(oldReady)) {
  throw new Error("Scanner patch stopped: ready/startup block not found.");
}
source = source.replace(oldReady, newReady);

console.log("[AVAILABILITY-FIX] Preorder/upcoming patch applied to bot.js");
console.log("[DISCORD-FIX] Direct Shopify cart links + product buttons applied");
console.log("[SCANNER-FIX] Fetch timeouts + scheduler startup guard applied");

eval(source);
