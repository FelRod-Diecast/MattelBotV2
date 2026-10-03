// Runtime availability/upcoming patch for MattelBotV2.
// Keeps the existing bot logic intact while applying the current
// preorder/ship-date detection fix before bot.js starts.

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

console.log("[AVAILABILITY-FIX] Preorder/upcoming patch applied to bot.js");

eval(source);
