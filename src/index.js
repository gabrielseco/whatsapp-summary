require("dotenv").config();
const express = require("express");
const { createClient, getRecentMessages, setTelegram } = require("./whatsapp");
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

let whatsappIsReady = false;

const whatsappReady = new Promise((resolve, reject) => {
  const client = createClient();
  const timeout = setTimeout(
    () => reject(new Error("WhatsApp auth timeout after 600s")),
    600_000,
  );
  client.on("ready", () => {
    clearTimeout(timeout);
    whatsappIsReady = true;
    resolve();
  });
  client.on("auth_failure", (msg) => {
    clearTimeout(timeout);
    reject(new Error(msg));
  });
  client.initialize().catch(reject);
});

app.get("/health", (_req, res) => {
  res.json({ ok: true, whatsappReady: whatsappIsReady });
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
