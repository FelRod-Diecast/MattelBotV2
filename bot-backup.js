require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const fs = require("fs");

const fetch = (...args) =>
  import("node-fetch").then(({ default: fetch }) => fetch(...args));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const DATA_FILE = "./scanData.json";
const CHANNEL_ID = process.env.CHANNEL_ID;

function loadProducts() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveProducts(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

async function getMattelData() {
  const response = await fetch("https://creations.mattel.com/products.json");
  return await response.json();
}

async function initializeProducts() {
  try {
    const data = await getMattelData();
    const products = data.products.filter((product) =>
      product.title.toLowerCase().includes("hot wheels")
    );

    const savedProducts = loadProducts();

    if (Object.keys(savedProducts).length === 0) {
      products.forEach((product) => {
        savedProducts[product.id] = {
          title: product.title,
          handle: product.handle,
          detectedAt: new Date().toISOString(),
        };
      });

      saveProducts(savedProducts);
      console.log(`✅ Initialized ${products.length} products`);
    }
  } catch (error) {
    console.error(error);
  }
}

async function scanForNewProducts() {
  try {
    const data = await getMattelData();
    const products = data.products.filter((product) =>
      product.title.toLowerCase().includes("hot wheels")
    );

    const savedProducts = loadProducts();

    if (!CHANNEL_ID) {
      console.log("⚠️ No CHANNEL_ID configured; skipping scanner post.");
      return;
    }

    const channel = await client.channels.fetch(CHANNEL_ID);

    for (const product of products) {
      if (!savedProducts[product.id]) {
        const price = product.variants?.[0]?.price || "Unknown";
        const inStock = product.variants?.some((v) => v.available);

        await channel.send(
          "🚨 **NEW HOT WHEELS DETECTED** 🚨\n\n" +
            `📦 ${product.title}\n` +
            `💲 $${price}\n` +
            `${inStock ? "✅ IN STOCK" : "❌ SOLD OUT"}\n` +
            `🔗 https://creations.mattel.com/products/${product.handle}`
        );

        savedProducts[product.id] = {
          title: product.title,
          handle: product.handle,
          detectedAt: new Date().toISOString(),
        };

        saveProducts(savedProducts);
        console.log(`🆕 New Product: ${product.title}`);
      }
    }

    console.log(`⏰ Scan Complete (${products.length} products)`);
  } catch (error) {
    console.error("❌ Scan Failed");
    console.error(error);
  }
}

function startScanner() {
  console.log("✅ Scanner Started");

  setInterval(async () => {
    await scanForNewProducts();
  }, 15 * 60 * 1000);
}

client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await initializeProducts();
  startScanner();
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!ping") {
    return message.reply("🏓 Pong!");
  }

  if (message.content === "!status") {
    const savedProducts = loadProducts();
    return message.reply(
      `✅ Online\n📦 Tracking ${Object.keys(savedProducts).length} products`
    );
  }

  if (message.content === "!help") {
    return message.reply(
      "🤖 Mattel Bot Commands\n\n" +
        "!ping - Test bot\n" +
        "!status - Check bot status\n" +
        "!help - Show commands\n" +
        "!scan - Latest Hot Wheels\n" +
        "!upcoming - Upcoming Hot Wheels"
    );
  }

  if (message.content === "!scan") {
    await message.reply("🔍 Checking Mattel...");

    try {
      const data = await getMattelData();
      const savedData = loadProducts();
      const hotWheelsProducts = data.products.filter((product) =>
        product.title.toLowerCase().includes("hot wheels")
      );

      let reply = "🚗 Latest Hot Wheels\n\n";
      hotWheelsProducts.slice(0, 5).forEach((product) => {
        const price = product.variants?.[0]?.price || "Unknown";
        const inStock = product.variants?.some((v) => v.available);

        reply +=
          `${inStock ? "✅ IN STOCK" : "❌ SOLD OUT"}\n` +
          `📦 ${product.title}\n` +
          `💲 $${price}\n` +
          `🔗 https://creations.mattel.com/products/${product.handle}\n\n`;
      });

      return message.reply(reply);
    } catch (error) {
      console.error(error);
      return message.reply("❌ Could not reach Mattel.");
    }
  }

  if (message.content === "!upcoming") {
    await message.reply("🚀 Checking upcoming Hot Wheels...");

    try {
      const data = await getMattelData();
      const upcomingProducts = data.products.filter((product) => {
        const available = product.variants?.some((v) => v.available);
        return !available;
      });

      if (upcomingProducts.length === 0) {
        return message.reply("❌ No upcoming products found.");
      }

      let reply = "🚀 Upcoming / Not Available Yet\n\n";
      upcomingProducts.slice(0, 5).forEach((product) => {
        const price = product.variants?.[0]?.price || "Unknown";
        reply +=
          `📦 ${product.title}\n` +
          `💲 $${price}\n` +
          `🔗 https://creations.mattel.com/products/${product.handle}\n\n`;
      });

      return message.reply(reply);
    } catch (error) {
      console.error(error);
      return message.reply("❌ Could not reach Mattel.");
    }
  }
});

process.on("unhandledRejection", (error) => {
  console.error(error);
});

process.on("uncaughtException", (error) => {
  console.error(error);
});

client.login(process.env.DISCORD_TOKEN);