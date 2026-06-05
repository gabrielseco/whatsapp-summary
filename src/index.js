require("dotenv").config();

// Suppress verbose multi-line session object dumps from libsignal
const _consoleInfo = console.info.bind(console);
console.info = (...args) => {
  const msg = String(args[0] ?? "");
  if (
    msg.startsWith("Closing session:") ||
    msg.startsWith("Opening session:") ||
    msg.startsWith("Removing old closed session:") ||
    msg.startsWith("Migrating session")
  )
    return;
  _consoleInfo(...args);
};

const https = require("https");
const express = require("express");
const { connect, getRecentMessages, setTelegram, isConnected } = require("./whatsapp");
const { summarize } = require("./summarizer");
const { createBot, sendSummary, sendMessage } = require("./telegram");

const app = express();
app.use(express.json());

function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${process.env.API_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

const bot = createBot();
setTelegram(bot, process.env.TELEGRAM_CHAT_ID);

const whatsappReady = connect();
whatsappReady.catch((err) => {
  console.error("Fatal: WhatsApp init failed:", err.message);
  process.exit(1);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, whatsappReady: isConnected() });
});

app.post("/summary", requireAuth, async (req, res) => {
  try {
    await whatsappReady;
    const chats = await getRecentMessages(24);
    console.log(`Fetched messages from ${chats.length} active chats`);
    const summary = await summarize(chats);
    await sendSummary(summary);
    console.log("Done");
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    await sendMessage(`Summary failed: ${err.message}`).catch(() => {});
    res.status(500).json({ error: err.message });
  }
});

function startKeepAlive() {
  const appName = process.env.FLY_APP_NAME;
  if (!appName) return;
  const url = `https://${appName}.fly.dev/health`;
  let elapsed = 0;
  const interval = setInterval(() => {
    if (isConnected() || elapsed >= 15 * 60) {
      clearInterval(interval);
      return;
    }
    elapsed += 10;
    https.get(url, (res) => res.resume()).on("error", () => {});
  }, 10_000);
  interval.unref();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startKeepAlive();
});
