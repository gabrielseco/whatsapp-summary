const { Client, LocalAuth } = require("whatsapp-web.js");
const QRCode = require("qrcode");

let client;
let telegramBot;
let telegramChatId;

function setTelegram(bot, chatId) {
  telegramBot = bot;
  telegramChatId = chatId;
}

function createClient() {
  client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      protocolTimeout: 600000,
    },
  });

  client.on("qr", async (qr) => {
    console.log("QR code received, sending to Telegram...");
    try {
      const buffer = await QRCode.toBuffer(qr, { scale: 8 });
      await telegramBot.sendPhoto(telegramChatId, buffer, {
        caption: "Scan this QR code with WhatsApp (Settings → Linked Devices)",
      });
      console.log("QR sent to Telegram");
    } catch (err) {
      console.error("Failed to send QR to Telegram:", err.message);
    }
  });

  client.on("ready", () => console.log("WhatsApp client ready"));
  client.on("auth_failure", (msg) => console.error("WhatsApp auth failed:", msg));
  client.on("disconnected", (reason) => console.warn("WhatsApp disconnected:", reason));

  return client;
}

async function getRecentMessages(hoursBack = 24) {
  const since = Date.now() - hoursBack * 60 * 60 * 1000;
  const chats = await client.getChats();

  // Skip chats with no recent activity before making expensive fetchMessages calls
  const activeChats = chats.filter(
    (chat) => chat.lastMessage && chat.lastMessage.timestamp * 1000 > since,
  );
  console.log(`${activeChats.length}/${chats.length} chats active in last ${hoursBack}h`);

  const BATCH_SIZE = 10;
  const results = [];

  for (let i = 0; i < activeChats.length; i += BATCH_SIZE) {
    const batch = activeChats.slice(i, i + BATCH_SIZE);
    const fetched = await Promise.allSettled(
      batch.map((chat) => chat.fetchMessages({ limit: 100 })),
    );

    for (let j = 0; j < batch.length; j++) {
      const result = fetched[j];
      if (result.status !== "fulfilled") continue;

      const chat = batch[j];
      const recent = result.value.filter((m) => m.timestamp * 1000 > since && !m.fromMe);
      if (recent.length === 0) continue;

      results.push({
        chatName: chat.name,
        isGroup: chat.isGroup,
        messages: recent.map((m) => ({
          from: m._data.notifyName || m.from.split("@")[0],
          body: m.hasMedia ? "[Media]" : m.body || "[no text]",
          time: new Date(m.timestamp * 1000).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        })),
      });
    }
  }

  return results;
}

module.exports = { createClient, getRecentMessages, setTelegram };
