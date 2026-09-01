require("dotenv").config();

const {
Client,
GatewayIntentBits,
EmbedBuilder
} = require("discord.js");
const fs = require("fs");
const cron = require("node-cron");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

const DATA_FILE = "./scanData.json";
const CHANNEL_ID = process.env.CHANNEL_ID;
const STATS_FILE = "./stats.json";

// =========================
// Product Storage
// =========================

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveProducts(data) {
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify(data, null, 2)
  );
}

function loadStats() {
try {
return JSON.parse(fs.readFileSync(STATS_FILE, "utf8"));
} catch {
return {
newProductsToday: 0,
restocksToday: 0,
soldOutToday: 0
};
}
}
 
function saveStats(stats) {
fs.writeFileSync(
STATS_FILE,
JSON.stringify(stats, null, 2)
);
}
// =========================
// Mattel API
// =========================

async function getMattelData() {
const allProducts = [];
let page = 1;
 
while (true) {
const response = await fetch(
`https://creations.mattel.com/products.json?page=${page}`
);
 
const text = await response.text();
 
if (text.startsWith("<!DOCTYPE")) {
break;
}
 
const data = JSON.parse(text);
 
if (!data.products || data.products.length === 0) {
break;
}
 
allProducts.push(...data.products);
console.log(`📄 Loaded page ${page}`);
 
page++;
}
 
return {
products: allProducts
};
}

// =========================
// Initial Product Load
// =========================

async function initializeProducts() {
  try {
    const data = await getMattelData();

  const products = data.products.filter(product => {
  const title = product.title.toLowerCase();

  return (
    title.includes("hot wheels") &&
    !title.includes("shirt") &&
    !title.includes("t-shirt") &&
    !title.includes("hat") &&
    !title.includes("dad hat") &&
    !title.includes("snapback") &&
    !title.includes("tumbler") &&
    !title.includes("sweatshirt") &&
    !title.includes("raglan") &&
    !title.includes("figure") &&
    !title.includes("mechanic shirt") &&
    !title.includes("jersey")
  );
});

    const savedProducts = loadProducts();

    const stats = loadStats();

    if (Object.keys(savedProducts).length === 0) {
      products.forEach(product => {
       const inStock =
product.variants?.some(v => v.available);
 
savedProducts[product.id] = {
title: product.title,
handle: product.handle,
available: inStock,
detectedAt: new Date().toISOString(),
lastSeen: new Date().toISOString()
};
      });

      saveProducts(savedProducts);
saveStats(stats);

      console.log(
        `✅ Initialized ${products.length} products`
      );
    }
  } catch (error) {
    console.error(error);
  }
}

// =========================
// Scanner
// =========================

async function scanForNewProducts() {
  try {
    const data = await getMattelData();

    const products = data.products.filter(product => {
  const title = product.title.toLowerCase();

  return (
    title.includes("hot wheels") &&
    !title.includes("shirt") &&
    !title.includes("t-shirt") &&
    !title.includes("hat") &&
    !title.includes("dad hat") &&
    !title.includes("snapback") &&
    !title.includes("tumbler") &&
    !title.includes("sweatshirt") &&
    !title.includes("raglan") &&
    !title.includes("figure") &&
    !title.includes("mechanic") &&
    !title.includes("jersey")
  );
});

    const savedProducts = loadProducts();
    const stats = loadStats();

    if (!CHANNEL_ID) {
      console.log("⚠️ CHANNEL_ID not configured");
      return;
    }

    const channel = await client.channels.fetch(CHANNEL_ID);

    for (const product of products) {
     
      const inStock =
product.variants?.some(v => v.available);
 
const existingProduct =
savedProducts[product.id];
      
      if (!savedProducts[product.id]) {
        const price =
          product.variants?.[0]?.price || "Unknown";
        console.log(
  "IMAGE:",
  product.images?.[0]?.src || "NO IMAGE"
);


               if (!inStock) {

  await channel.send(
    "🚨 **POSSIBLE HIDDEN PRODUCT DETECTED** 🚨\n\n" +
    `📦 ${product.title}\n` +
    `💲 $${price}\n` +
    `❌ NOT AVAILABLE YET\n` +
    `👀 First time seen in Mattel API\n` +
    `🔗 https://creations.mattel.com/products/${product.handle}`
  );

} else {

  await channel.send(
    "🚨 **NEW HOT WHEELS DETECTED** 🚨\n\n" +
    `📦 ${product.title}\n` +
    `💲 $${price}\n` +
    `✅ IN STOCK\n` +
    `🔗 https://creations.mattel.com/products/${product.handle}`
  );

}

   savedProducts[product.id] = {
title: product.title,
handle: product.handle,
available: inStock,
price: price,
detectedAt: new Date().toISOString(),
lastSeen: new Date().toISOString()
};
 
stats.newProductsToday++;
 
console.log(
`🆕 New Product Found: ${product.title}`
);
}
else {
 
if (
existingProduct.available === false &&
inStock === true
) {
 
await channel.send(
`🔥 BACK IN STOCK 🔥\n\n` +
`📦 ${product.title}\n` +
`🔗 https://creations.mattel.com/products/${product.handle}`
);
 
stats.restocksToday++;
 
console.log(
`🔥 Restock Detected: ${product.title}`
);
}
 
if (
existingProduct.available === true &&
inStock === false
) {
 
await channel.send(
`❌ SOLD OUT ❌\n\n` +
`📦 ${product.title}\n` +
`🔗 https://creations.mattel.com/products/${product.handle}`
);
 
stats.soldOutToday++;
 
console.log(
`❌ Sold Out: ${product.title}`
);
}
 
const currentPrice =
  product.variants?.[0]?.price || "Unknown";

if (
  existingProduct.price &&
  existingProduct.price !== currentPrice
) {

  await channel.send(
    `💲 PRICE CHANGE DETECTED 💲\n\n` +
    `📦 ${product.title}\n` +
    `💲 Old Price: $${existingProduct.price}\n` +
    `💲 New Price: $${currentPrice}\n` +
    `🔗 https://creations.mattel.com/products/${product.handle}`
  );

  console.log(
    `💲 Price Changed: ${product.title}`
  );

}

savedProducts[product.id].price =
  currentPrice;

savedProducts[product.id].available =
  inStock;

savedProducts[product.id].lastSeen =
  new Date().toISOString();
}
}
 
saveProducts(savedProducts);
saveStats(stats);
 
console.log(
`⏰ Scan Complete - ${products.length} products checked`
);

  } catch (error) {
    console.error("❌ Scan Failed");
    console.error(error);
  }
}

function startScanner() {
  console.log("✅ Scanner Started");

  setInterval(async () => {
    await scanForNewProducts();
  }, 5 * 60 * 1000);
}
function startDailySummary() {

  cron.schedule(
    "0 8 * * *",
    async () => {

      try {

        const channel =
          await client.channels.fetch(CHANNEL_ID);

        const stats = loadStats();
        const savedProducts = loadProducts();

        await channel.send(
          "📊 **MattelBot Daily Summary**\n\n" +
          `📦 Tracking: ${Object.keys(savedProducts).length}\n` +
          `🆕 New Products: ${stats.newProductsToday}\n` +
          `🔥 Restocks: ${stats.restocksToday}\n` +
          `❌ Sold Out: ${stats.soldOutToday}`
        );

        stats.newProductsToday = 0;
        stats.restocksToday = 0;
        stats.soldOutToday = 0;

        saveStats(stats);

        console.log(
          "📊 Daily summary sent and stats reset"
        );

      } catch (error) {

        console.error(
          "❌ Daily summary failed"
        );

        console.error(error);

      }

    },
    {
      timezone: "America/Chicago"
    }
  );

}
// =========================
// Bot Ready
// =========================

client.once("clientReady", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  await initializeProducts();
 
startScanner();
startDailySummary();
});

// =========================
// Commands
// =========================

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  // Ping
  if (message.content === "!ping") {
    return message.reply("🏓 Pong!");
  }

  // Status
  if (message.content === "!status") {
    const savedProducts = loadProducts();

    return message.reply(
      `✅ Online\n📦 Tracking ${Object.keys(savedProducts).length} products`
    );
  }
// Stats
if (message.content === "!stats") {
  const stats = loadStats();

  return message.reply(
    "📊 MattelBot Daily Stats\n\n" +
    `🆕 New Products: ${stats.newProductsToday}\n` +
    `🔥 Restocks: ${stats.restocksToday}\n` +
    `❌ Sold Out: ${stats.soldOutToday}`
  );
}
  // Debug
if (message.content === "!debug") {

  const savedProducts = loadProducts();
  const stats = loadStats();

  return message.reply(
    "🛠️ MattelBot Debug\n\n" +
    `📦 Tracked Products: ${Object.keys(savedProducts).length}\n` +
    `🆕 New Products Today: ${stats.newProductsToday}\n` +
    `🔥 Restocks Today: ${stats.restocksToday}\n` +
    `❌ Sold Out Today: ${stats.soldOutToday}\n` +
    `📁 Data File: ${DATA_FILE}`
  );
}
// Test Embed
if (message.content === "!embed") {

  const embed = new EmbedBuilder()
    .setColor(0xff0000)
    .setTitle("🚗 MattelBot Embed Test")
    .setDescription("Embeds are working.")
    .addFields(
      {
        name: "Price",
        value: "$24.99",
        inline: true
      },
      {
        name: "Status",
        value: "✅ In Stock",
        inline: true
      }
    )
    .setURL("https://creations.mattel.com")
    .setFooter({
      text: "MattelBotV2"
    });

  return message.reply({
    embeds: [embed]
  });

}

// Test Daily Summary
if (message.content === "!summary") {
  // Test Daily Summary
if (message.content === "!summary") {
  const stats = loadStats();
  const savedProducts = loadProducts();

  return message.reply(
    "📊 MattelBot Daily Summary\n\n" +
    `📦 Tracking: ${Object.keys(savedProducts).length}\n` +
    `🆕 New Products: ${stats.newProductsToday}\n` +
    `🔥 Restocks: ${stats.restocksToday}\n` +
    `❌ Sold Out: ${stats.soldOutToday}`
  );
}
  // Latest Products
if (message.content === "!latest") {

  const savedProducts = loadProducts();

  const latestProducts = Object.values(savedProducts)
    .sort(
      (a, b) =>
        new Date(b.detectedAt) -
        new Date(a.detectedAt)
    )
    .slice(0, 10);

  if (latestProducts.length === 0) {
    return message.reply(
      "❌ No products found."
    );
  }

  let reply =
    "📦 Latest 10 Products\n\n";

  latestProducts.forEach(
    (product, index) => {

      reply +=
        `${index + 1}. ${product.title}\n`;

    }
  );

  return message.reply(reply);

}
  // Help
if (message.content === "!help") {
  return message.reply(
    "🤖 Mattel Scanner Commands\n\n" +
    "!status\n" +
    "!stats\n" +
    "!debug\n" +
    "!summary\n" +
    "!latest\n" +
    "!embed\n" +
    "!help\n" +
    "!scan\n" +
    "!upcoming"
  );
}
  // Scan
  if (message.content === "!scan") {
    try {
      const data = await getMattelData();

      const products = data.products.filter(product =>
        product.title.toLowerCase().includes("hot wheels")
      );

      let reply = "🚗 Latest Hot Wheels\n\n";

      products.slice(0, 5).forEach(product => {
        const price =
          product.variants?.[0]?.price || "Unknown";

        const inStock =
          product.variants?.some(v => v.available);

        reply +=
          `${inStock ? "✅ IN STOCK" : "❌ SOLD OUT"}\n` +
          `📦 ${product.title}\n` +
          `💲 $${price}\n` +
          `🔗 https://creations.mattel.com/products/${product.handle}\n\n`;
      });

      return message.reply(reply);

    } catch (error) {
      console.error(error);
      return message.reply(
        "❌ Could not reach Mattel."
      );
    }
  }

  // Upcoming
  if (message.content === "!upcoming") {
    try {
      const data = await getMattelData();

      const products = data.products.filter(product => {
        const available =
          product.variants?.some(v => v.available);

        return !available;
      });

      let reply =
        "🚀 Upcoming / Not Available Yet\n\n";

      products.slice(0, 5).forEach(product => {
        const price =
          product.variants?.[0]?.price || "Unknown";

        reply +=
          `📦 ${product.title}\n` +
          `💲 $${price}\n` +
          `🔗 https://creations.mattel.com/products/${product.handle}\n\n`;
      });

      return message.reply(reply);

    } catch (error) {
      console.error(error);
      return message.reply(
        "❌ Could not reach Mattel."
      );
    }
  }
});

// =========================
// Error Handling
// =========================

process.on("unhandledRejection", error => {
  console.error(error);
});

process.on("uncaughtException", error => {
  console.error(error);
});

// =========================
// Login
// =========================

client.login(process.env.DISCORD_TOKEN);
// Stable Backup
