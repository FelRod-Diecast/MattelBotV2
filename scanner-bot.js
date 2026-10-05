const { Client, GatewayIntentBits } = require('discord.js');
const cron = require('node-cron');
const { MattelScanner } = require('./scanner');
const { loadProducts, loadEvents, loadState } = require('./scanner/storage');

const CHANNEL_ID = process.env.CHANNEL_ID;
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent] });
let scanner;

function products() { return Object.values(loadProducts()); }

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  const channel = CHANNEL_ID ? await client.channels.fetch(CHANNEL_ID).catch(() => null) : null;
  scanner = new MattelScanner({ channel });
  await scanner.scan();
  setInterval(() => scanner.scan().catch(error => console.error('[SCAN] Scheduled failure', error.message)), 5 * 60 * 1000);
  console.log('✅ Scanner Engine started - 5 minute catalog cycle; candidate verification is selective');
});

client.on('messageCreate', async message => {
  if (message.author.bot) return;
  const command = message.content.trim().toLowerCase();
  try {
    if (command === '!ping') return message.reply('🏓 Pong!');
    if (command === '!status') return message.reply(`✅ Online\n📦 Tracking ${products().length} Hot Wheels products`);
    if (command === '!counts') {
      const all = products();
      return message.reply(`📦 Tracked: ${all.length}\n🛒 Available: ${all.filter(p => p.status === 'AVAILABLE').length}\n🚀 Upcoming: ${all.filter(p => p.status === 'UPCOMING').length}\n🚨 Hidden: ${all.filter(p => p.hiddenScore >= 70).length}\n❌ Sold Out: ${all.filter(p => p.status === 'SOLD_OUT').length}`);
    }
    if (command === '!hidden') {
      const hidden = products().filter(p => p.hiddenScore >= 70).sort((a,b) => b.hiddenScore-a.hiddenScore).slice(0,25);
      return message.reply(hidden.length ? `🚨 Hidden Products\n\n${hidden.map(p => `${p.hiddenScore}/100 — ${p.title}\n${p.url}`).join('\n\n')}` : '✅ No high-confidence hidden products tracked.');
    }
    if (command === '!upcoming') {
      const upcoming = products().filter(p => p.upcoming && (!p.launchDate || Date.parse(p.launchDate) > Date.now())).sort((a,b) => Date.parse(a.launchDate||'9999')-Date.parse(b.launchDate||'9999')).slice(0,25);
      return message.reply(upcoming.length ? `🚀 Upcoming Products\n\n${upcoming.map(p => `${p.title}\n📅 ${p.launchDate || 'Coming Soon'}\n${p.url}`).join('\n\n')}` : '✅ No future upcoming products tracked.');
    }
    if (command === '!events') {
      const events = loadEvents().slice(-15).reverse();
      return message.reply(events.length ? `📡 Latest Events\n\n${events.map(e => `#${e.id} ${e.type} — ${e.title}`).join('\n')}` : 'No events recorded.');
    }
    if (command === '!health') {
      const s = loadState();
      return message.reply(`🤖 Scanner Health\n\nLast successful scan: ${s.lastSuccessfulScanAt || 'Never'}\nConsecutive failures: ${s.consecutiveFailures || 0}\nScanner version: ${s.scannerVersion}`);
    }
    if (command === '!scan') {
      if (!scanner) return message.reply('⏳ Scanner is still starting.');
      const result = await scanner.scan();
      return message.reply(`🔎 Scan complete: ${result.scanned || 0} products, ${result.events?.length || 0} events.`);
    }
  } catch (error) {
    console.error('[COMMAND]', error);
    await message.reply('❌ Command failed. Check Railway logs.').catch(() => {});
  }
});

cron.schedule('0 8 * * *', async () => {
  if (!CHANNEL_ID) return;
  const channel = await client.channels.fetch(CHANNEL_ID).catch(() => null);
  if (channel) await channel.send(`📊 Mattel Scanner Daily\n📦 Tracking: ${products().length}\n📡 Events stored: ${loadEvents().length}`);
}, { timezone: 'America/Chicago' });

if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is not configured.');
client.login(process.env.DISCORD_TOKEN);
