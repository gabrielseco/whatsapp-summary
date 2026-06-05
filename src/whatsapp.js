const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");

const AUTH_FOLDER = process.env.WA_AUTH_FOLDER || ".wa_auth";
const MSG_STORE_FILE = `${AUTH_FOLDER}/msg_store.json`;
const BAILEYS_LOGGER = pino({ level: "warn" });

let sock = null;
let telegramBot = null;
let telegramChatId = null;
let qrMessageId = null;
let connected = false;

// Minimal in-memory store (makeInMemoryStore was removed in Baileys 6.7)
const chatMeta = new Map(); // jid → { name, isGroup }
const msgStore = new Map(); // jid → proto.IWebMessageInfo[]

function loadMsgStore() {
  try {
    if (!fs.existsSync(MSG_STORE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(MSG_STORE_FILE, "utf8"));
    const cutoff = Date.now() - 25 * 60 * 60 * 1000; // keep up to 25h
    for (const [jid, msgs] of Object.entries(raw.msgs || {})) {
      const fresh = msgs.filter((m) => Number(m.messageTimestamp) * 1000 > cutoff);
      if (fresh.length) msgStore.set(jid, fresh);
    }
    for (const [jid, meta] of Object.entries(raw.chats || {})) {
      chatMeta.set(jid, meta);
    }
    console.log(`Loaded msg store: ${msgStore.size} chats`);
  } catch (e) {
    console.warn("Could not load msg store:", e.message);
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const data = {
        chats: Object.fromEntries(chatMeta),
        msgs: Object.fromEntries(msgStore),
      };
      fs.writeFileSync(MSG_STORE_FILE, JSON.stringify(data));
    } catch (e) {
      console.warn("Could not save msg store:", e.message);
    }
  }, 2_000);
}

function setTelegram(bot, chatId) {
  telegramBot = bot;
  telegramChatId = chatId;
}

function isConnected() {
  return connected;
}

async function sendQRToTelegram(qr) {
  try {
    const buffer = await QRCode.toBuffer(qr, { scale: 8 });
    if (qrMessageId) {
      try {
        await telegramBot.deleteMessage(telegramChatId, qrMessageId);
      } catch {}
      qrMessageId = null;
    }
    const sent = await telegramBot.sendPhoto(telegramChatId, buffer, {
      caption:
        "Scan this QR code with WhatsApp (Settings → Linked Devices)\n⏱ Refreshes every ~20s — scan the latest one",
    });
    qrMessageId = sent.message_id;
  } catch (err) {
    console.error("Failed to send QR to Telegram:", err.message);
  }
}

function storeChats(chats) {
  for (const chat of chats || []) {
    if (chat.id) {
      chatMeta.set(chat.id, {
        name: chat.name || chat.id.split("@")[0],
        isGroup: chat.id.endsWith("@g.us"),
      });
    }
  }
  scheduleSave();
}

function storeMessages(msgs) {
  for (const msg of msgs || []) {
    const jid = msg.key?.remoteJid;
    if (!jid || jid === "status@broadcast") continue;
    if (!msgStore.has(jid)) msgStore.set(jid, []);
    const existing = msgStore.get(jid);
    const id = msg.key.id;
    if (!existing.some((m) => m.key.id === id)) existing.push(msg);
  }
  scheduleSave();
}

async function connect() {
  loadMsgStore();
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  sock = makeWASocket({
    version,
    auth: state,
    logger: BAILEYS_LOGGER,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("WhatsApp auth timeout after 600s")),
      600_000,
    );

    let settled = false;
    function settle(fn, val) {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn(val);
    }

    // Resolve 3s after the last incoming message batch, or after 20s max.
    let quietTimer = null;
    const done = () => {
      clearTimeout(quietTimer);
      console.log("WhatsApp ready");
      settle(resolve, undefined);
    };
    const resetQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(done, 3_000);
    };

    sock.ev.process(async (events) => {
      if (events["creds.update"]) {
        await saveCreds();
      }

      if (events["messaging-history.set"]) {
        const { chats, messages } = events["messaging-history.set"];
        console.log(
          `messaging-history.set: ${chats?.length ?? 0} chats, ${messages?.length ?? 0} messages`,
        );
        storeChats(chats);
        storeMessages(messages);
      }

      if (events["chats.upsert"]) {
        storeChats(events["chats.upsert"]);
      }

      if (events["messages.upsert"]) {
        const { messages } = events["messages.upsert"];
        console.log(`messages.upsert: ${messages?.length ?? 0} messages`);
        storeMessages(messages);
        if (!settled) resetQuiet();
      }

      if (events["connection.update"]) {
        const { connection, lastDisconnect, qr } = events["connection.update"];

        if (qr) await sendQRToTelegram(qr);

        if (connection === "open") {
          connected = true;
          if (qrMessageId) {
            telegramBot.deleteMessage(telegramChatId, qrMessageId).catch(() => {});
            qrMessageId = null;
          }
          console.log("WhatsApp connected, waiting for message sync...");
          resetQuiet();
          setTimeout(done, 20_000);
        }

        if (connection === "close") {
          connected = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode ?? 500;
          const loggedOut = statusCode === DisconnectReason.loggedOut;
          console.warn(`WhatsApp closed (code=${statusCode}, loggedOut=${loggedOut})`);

          if (!settled) {
            if (loggedOut) {
              fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            }
            settle(
              reject,
              new Error(loggedOut ? "WhatsApp logged out" : `Connect failed: ${statusCode}`),
            );
            return;
          }

          if (loggedOut) {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
            console.error("WhatsApp logged out — restarting for fresh QR scan");
            process.exit(1);
          }

          setTimeout(
            () =>
              connect().catch((e) => {
                console.error("Reconnect failed:", e.message);
                process.exit(1);
              }),
            5_000,
          );
        }
      }
    });
  });
}

function extractText(msg) {
  // messageStubType 2 = CIPHERTEXT — Baileys failed to decrypt
  if (msg.messageStubType === 2) return "[decrypt failed]";
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ||
    m.extendedTextMessage?.text ||
    m.imageMessage?.caption ||
    m.videoMessage?.caption ||
    m.documentMessage?.caption ||
    null
  );
}

async function getRecentMessages(hoursBack = 24) {
  const since = Date.now() - hoursBack * 60 * 60 * 1000;
  const results = [];

  console.log(`Store has messages for ${msgStore.size} chats`);

  for (const [jid, msgs] of msgStore.entries()) {
    const recent = msgs.filter((msg) => {
      const ts = Number(msg.messageTimestamp) * 1000;
      return ts > since && !msg.key.fromMe;
    });

    if (recent.length === 0) continue;

    const meta = chatMeta.get(jid) || {
      name: jid.split("@")[0],
      isGroup: jid.endsWith("@g.us"),
    };

    results.push({
      chatName: meta.name,
      isGroup: meta.isGroup,
      messages: recent.map((msg) => {
        const ts = Number(msg.messageTimestamp) * 1000;
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const from = msg.pushName || senderJid?.split("@")[0] || "Unknown";
        return {
          from,
          body: extractText(msg) || "[Media]",
          time: new Date(ts).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        };
      }),
    });
  }

  console.log(`Recent messages found in ${results.length} chats`);
  return results;
}

module.exports = { connect, getRecentMessages, setTelegram, isConnected };
