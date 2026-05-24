require('dotenv').config();
const { createClient, getRecentMessages } = require('./whatsapp');
const { summarize } = require('./summarizer');
const { createBot, sendSummary, sendMessage } = require('./telegram');

async function main() {
  createBot();
  const client = createClient();

  // Wait for WhatsApp session to load (saved session = no QR needed)
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('WhatsApp auth timeout after 300s')), 300_000);
    client.on('ready', () => { clearTimeout(timeout); resolve(); });
    client.on('auth_failure', (msg) => { clearTimeout(timeout); reject(new Error(msg)); });
    client.initialize().catch(reject);
  });

  try {
    const chats = await getRecentMessages(24);
    console.log(`Fetched messages from ${chats.length} active chats`);
    const summary = await summarize(chats);
    await sendSummary(summary);
    console.log('Done');
  } catch (err) {
    await sendMessage(`Summary failed: ${err.message}`).catch(() => {});
    throw err;
  } finally {
    await client.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
