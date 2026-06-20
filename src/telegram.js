const TelegramBot = require("node-telegram-bot-api");
const aliases = require("./aliases");

let bot;
let chatId;

function createBot() {
  chatId = process.env.TELEGRAM_CHAT_ID;
  bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });
  return bot;
}

function isAuthorized(msg) {
  return String(msg.chat.id) === String(chatId);
}

function setupCommands(getKnownNames) {
  bot.onText(/\/names/, (msg) => {
    if (!isAuthorized(msg)) return;
    const known = getKnownNames();
    if (known.length === 0) {
      bot.sendMessage(chatId, "No contacts loaded yet.");
      return;
    }
    const current = aliases.getAll();
    const seen = new Set();
    const lines = [];
    for (const c of known) {
      if (seen.has(c.name)) continue;
      seen.add(c.name);
      const type = c.isGroup ? "👥" : "👤";
      const alias = current[c.name];
      lines.push(alias ? `${type} ${c.name} → *${alias}*` : `${type} ${c.name}`);
    }
    const text = `*Known contacts/groups:*\n${lines.join("\n")}`;
    bot.sendMessage(chatId, text, { parse_mode: "Markdown" });
  });

  bot.onText(/\/alias(?:\s+(.+))?/, (msg, match) => {
    if (!isAuthorized(msg)) return;
    const args = (match[1] || "").trim();
    if (!args) {
      const current = aliases.getAll();
      const entries = Object.entries(current);
      if (entries.length === 0) {
        bot.sendMessage(chatId, "No aliases set.\nUsage: `/alias OldName RealName`", {
          parse_mode: "Markdown",
        });
        return;
      }
      const lines = entries.map(([from, to]) => `• ${from} → *${to}*`);
      bot.sendMessage(chatId, `*Current aliases:*\n${lines.join("\n")}`, {
        parse_mode: "Markdown",
      });
      return;
    }

    const spaceIdx = args.indexOf(" ");
    if (spaceIdx === -1) {
      bot.sendMessage(chatId, "Usage: `/alias OldName RealName`\nRemove: `/unalias OldName`", {
        parse_mode: "Markdown",
      });
      return;
    }

    const from = args.slice(0, spaceIdx);
    const to = args.slice(spaceIdx + 1);
    aliases.set(from, to);
    bot.sendMessage(chatId, `Alias set: ${from} → *${to}*`, { parse_mode: "Markdown" });
  });

  bot.onText(/\/unalias(?:\s+(.+))?/, (msg, match) => {
    if (!isAuthorized(msg)) return;
    const name = (match[1] || "").trim();
    if (!name) {
      bot.sendMessage(chatId, "Usage: `/unalias OldName`", { parse_mode: "Markdown" });
      return;
    }
    aliases.remove(name);
    bot.sendMessage(chatId, `Alias removed for: ${name}`);
  });
}

async function sendSummary(summary) {
  const date = new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const message = `*WhatsApp Digest — ${date}*\n\n${summary}`;
  await bot.sendMessage(chatId, message, { parse_mode: "Markdown" });
}

async function sendMessage(text) {
  await bot.sendMessage(chatId, text);
}

module.exports = { createBot, setupCommands, sendSummary, sendMessage };
