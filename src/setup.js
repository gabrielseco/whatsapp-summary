/**
 * Run once to get your Telegram chat ID: npm run setup
 * Send any message to your bot, this script prints your chat ID.
 */
require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error('TELEGRAM_BOT_TOKEN not set in .env');
  process.exit(1);
}

console.log('Waiting for a message from you in Telegram...');
console.log('Open your bot and send any message.\n');

const bot = new TelegramBot(token, { polling: true });

bot.on('message', (msg) => {
  console.log('Your Telegram Chat ID:', msg.chat.id);
  console.log('\nAdd this to your .env:');
  console.log(`TELEGRAM_CHAT_ID=${msg.chat.id}`);
  bot.stopPolling();
  process.exit(0);
});
