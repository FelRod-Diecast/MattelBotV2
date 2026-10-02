// start.js
const fs = require("fs");
const path = require("path");

function parseLaunchTimestamp(value) {
  if (!value) return NaN;
  const raw = String(value).trim();
  const direct = Date.parse(raw);
  if (Number.isFinite(direct)) return direct;
  const match = raw.match(/^(.+?)\s+(\d{1,2}:\d{2}\s*(?:am|pm))\s+PT$/i);
  if (!match) return NaN;
  const dateMatch = match[1].match(/^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/);
  if (!dateMatch) return NaN;
  const month = dateMatch[1], day = Number(dateMatch[2]), year = Number(dateMatch[3]);
  const monthIndex = new Date(`${month} 1, ${year} 00:00:00 UTC`).getUTCMonth();
  if (!Number.isFinite(monthIndex)) return NaN;
  const offsetHours = monthIndex >= 2 && monthIndex <= 9 ? 7 : 8;
  const timePart = match[2].replace(/\s+/g, " ").toUpperCase();
  const parsed = Date.parse(`${month} ${day}, ${year} ${timePart} GMT-${String(offsetHours).padStart(2, "0")}00`);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function formatLaunchDate(timestamp) {
  if (!Number.isFinite(timestamp)) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(timestamp)) + " PT";
}

function getFutureUpcoming(products, now = Date.now(), limit = 15) {
  return Object.values(products || {})
    .map(product => ({ product, launchTimestamp: parseLaunchTimestamp(product?.launchDate) }))
    .filter(item => item.product?.upcoming === true && Number.isFinite(item.launchTimestamp) && item.launchTimestamp > now)
    .sort((a, b) => a.launchTimestamp - b.launchTimestamp)
    .slice(0, limit);
}

function buildSummary(products, stats, now = Date.now()) {
  const list = Object.values(products || {});
  const inStock = list.filter(p => p.available === true).length;
  const soldOut = list.filter(p => p.available === false).length;
  const hidden = list.filter(p => p.wasHidden === true).length;
  const futureAll = getFutureUpcoming(products, now, 1000);
  const upcoming = futureAll.slice(0, 3);
  let lastScan = "Not recorded";
  let nextScan = "Unknown";
  if (stats?.lastScanAt) {
    const last = Date.parse(stats.lastScanAt);
    if (Number.isFinite(last)) {
      const elapsed = Math.max(0, now - last);
      const agoMinutes = Math.floor(elapsed / 60000);
      lastScan = agoMinutes < 1 ? "Just now" : `${agoMinutes} min ago`;
      const nextMinutes = Math.ceil(Math.max(0, 5 * 60 * 1000 - elapsed) / 60000);
      nextScan = nextMinutes <= 1 ? "~1 min" : `~${nextMinutes} min`;
    }
  }
  const lines = ["📊 **MattelBot Summary**", "", "📦 **INVENTORY**", `Tracked: **${list.length}**`, `In Stock: **${inStock}**`, `Sold Out: **${soldOut}**`, "", "📈 **TODAY**", `New Products: **${Number(stats?.newProductsToday || 0)}**`, `Restocks: **${Number(stats?.restocksToday || 0)}**`, `Sold Out Events: **${Number(stats?.soldOutToday || 0)}**`, `Price Changes: **${Number(stats?.priceChangesToday || 0)}**`, "", "🚀 **UPCOMING**", `Future Releases: **${futureAll.length}**`];
  if (upcoming.length) for (const item of upcoming) { lines.push(`• ${item.product.title}`); lines.push(`  📅 ${formatLaunchDate(item.launchTimestamp)}`); }
  else lines.push("• No future launch dates currently tracked");
  lines.push("", "🚨 **OPPORTUNITIES**", `Hidden: **${hidden}**`, "", "🕐 **SCANNER**", `Last Scan: **${lastScan}**`, `Next Scan: **${nextScan}**`, "Schedule: **Every 5 minutes**");
  return lines.join("\n");
}

function patchSource(source) {
  const upcomingPattern = /      if \(\s+content === "!upcoming"\s+\) \{[\s\S]*?\n      \}\n\n      if \(\s+content === "!latest"/;
  const upcomingReplacement = `      if (\n        content === "!upcoming"\n      ) {\n        const upcoming = getFutureUpcoming(loadProducts());\n        if (!upcoming.length) return message.reply("✅ No future launches tracked.");\n        const lines = ["🚀 **UPCOMING HOT WHEELS**", ""];\n        upcoming.forEach((item, index) => {\n          lines.push(\`**\${index + 1}. \${item.product.title}**\`, \`📅 \${formatLaunchDate(item.launchTimestamp)}\`, "📦 Status: **UPCOMING**", \`🔗 \${item.product.url || productUrl(item.product.handle)}\`, "");\n        });\n        lines.push(\`📊 **Future releases shown: \${upcoming.length}**\`);\n        return message.reply(lines.join("\\n"));\n      }\n\n      if (content === "!latest"`;
  if (!upcomingPattern.test(source)) throw new Error("!upcoming block not found; refusing to start unpatched bot.");
  source = source.replace(upcomingPattern, upcomingReplacement);

  const summaryPattern = /      if \(\s+content === "!summary"\s+\) \{[\s\S]*?\n      \}\n\n      if \(\s+content === "!scan"/;
  const summaryReplacement = `      if (\n        content === "!summary"\n      ) {\n        return message.reply(buildSummary(loadProducts(), loadStats()));\n      }\n\n      if (content === "!scan"`;
  if (!summaryPattern.test(source)) throw new Error("!summary block not found; refusing to start unpatched bot.");
  source = source.replace(summaryPattern, summaryReplacement);

  const dailyPattern = /        await channel\.send\(\s+"📊 \*\*MattelBot Daily Summary\*\*\\n\\n" \+\s+`📦 Tracking: \$\{Object\.keys\(products\)\.length\}\\n` \+\s+`🆕 New Products: \$\{stats\.newProductsToday\}\\n` \+\s+`🔥 Restocks: \$\{stats\.restocksToday\}\\n` \+\s+`❌ Sold Out: \$\{stats\.soldOutToday\}\\n` \+\s+`💲 Price Changes: \$\{stats\.priceChangesToday\}`\s+\);/;
  const dailyReplacement = `        await channel.send(\n          buildSummary(products, stats)\n        );`;
  if (!dailyPattern.test(source)) throw new Error("daily summary block not found; refusing to start unpatched bot.");
  source = source.replace(dailyPattern, dailyReplacement);
  return source;
}

function start() {
  const botPath = path.join(__dirname, "bot.js");
  const source = fs.readFileSync(botPath, "utf8");
  const patched = patchSource(source);
  const runtimePath = path.join(__dirname, ".bot-runtime.js");
  const helperSource = `\n${parseLaunchTimestamp.toString()}\n${formatLaunchDate.toString()}\n${getFutureUpcoming.toString()}\n${buildSummary.toString()}\n`;
  fs.writeFileSync(runtimePath, helperSource + patched, "utf8");
  console.log("🧩 Display patch applied: !upcoming + !summary + daily summary");
  console.log("🛡️ Core bot.js scanner and 5-minute schedule are unchanged.");
  require(runtimePath);
}

module.exports = { parseLaunchTimestamp, formatLaunchDate, getFutureUpcoming, buildSummary, patchSource };
if (require.main === "module") start();
