const TelegramBot = require('node-telegram-bot-api');

let bot;

function createBot() {
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: false });
  return bot;
}

async function sendSummary(summary) {
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const message = `*WhatsApp Digest — ${date}*\n\n${summary}`;
  await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, message, {
    parse_mode: 'Markdown',
  });
}

async function sendMessage(text) {
  await bot.sendMessage(process.env.TELEGRAM_CHAT_ID, text);
}

module.exports = { createBot, sendSummary, sendMessage };
