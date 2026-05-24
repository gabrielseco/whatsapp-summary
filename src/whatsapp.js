const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

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
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    },
  });

  client.on('qr', async (qr) => {
    console.log('QR code received, sending to Telegram...');
    try {
      const buffer = await QRCode.toBuffer(qr, { scale: 8 });
      await telegramBot.sendPhoto(telegramChatId, buffer, {
        caption: 'Scan this QR code with WhatsApp (Settings → Linked Devices)',
      });
      console.log('QR sent to Telegram');
    } catch (err) {
      console.error('Failed to send QR to Telegram:', err.message);
    }
  });

  client.on('ready', () => console.log('WhatsApp client ready'));
  client.on('auth_failure', (msg) => console.error('WhatsApp auth failed:', msg));
  client.on('disconnected', (reason) => console.warn('WhatsApp disconnected:', reason));

  return client;
}

async function getRecentMessages(hoursBack = 24) {
  const since = Date.now() - hoursBack * 60 * 60 * 1000;
  const chats = await client.getChats();
  const results = [];

  for (const chat of chats) {
    let messages;
    try {
      messages = await chat.fetchMessages({ limit: 100 });
    } catch {
      continue;
    }

    const recent = messages.filter((m) => m.timestamp * 1000 > since && !m.fromMe);
    if (recent.length === 0) continue;

    results.push({
      chatName: chat.name,
      isGroup: chat.isGroup,
      messages: recent.map((m) => ({
        from: m._data.notifyName || m.from.split('@')[0],
        body: m.hasMedia ? '[Media]' : m.body || '[no text]',
        time: new Date(m.timestamp * 1000).toLocaleTimeString('en-GB', {
          hour: '2-digit',
          minute: '2-digit',
        }),
      })),
    });
  }

  return results;
}

module.exports = { createClient, getRecentMessages };
