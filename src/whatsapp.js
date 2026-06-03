const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeInMemoryStore,
} = require("@whiskeysockets/baileys");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");

const AUTH_FOLDER = process.env.WA_AUTH_FOLDER || "/app/.wa_auth";
const SILENT = pino({ level: "silent" });

let sock = null;
let store = null;
let telegramBot = null;
let telegramChatId = null;
let qrMessageId = null;
let connected = false;

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

async function connect() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const { version } = await fetchLatestBaileysVersion();

  store = makeInMemoryStore({ logger: SILENT });

  sock = makeWASocket({
    version,
    auth: state,
    logger: SILENT,
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  store.bind(sock.ev);
  sock.ev.on("creds.update", saveCreds);

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

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) await sendQRToTelegram(qr);

      if (connection === "open") {
        connected = true;
        if (qrMessageId) {
          telegramBot.deleteMessage(telegramChatId, qrMessageId).catch(() => {});
          qrMessageId = null;
        }
        console.log("WhatsApp connected, waiting for message sync...");

        // Wait for offline messages to finish arriving before resolving.
        // Resolves 3s after the last message.upsert, or after 20s max.
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
        sock.ev.on("messages.upsert", resetQuiet);
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
            // Stale auth — clear it so the next process start generates a fresh QR
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
          }
          settle(reject, new Error(loggedOut ? "WhatsApp logged out" : `Connect failed: ${statusCode}`));
          return;
        }

        if (loggedOut) {
          fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
          console.error("WhatsApp logged out — restarting for fresh QR scan");
          process.exit(1);
        }

        // Transient disconnect — reconnect silently
        setTimeout(
          () =>
            connect().catch((e) => {
              console.error("Reconnect failed:", e.message);
              process.exit(1);
            }),
          5_000,
        );
      }
    });
  });
}

function extractText(msg) {
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

  const jids = Object.keys(store.messages);
  console.log(`Store has messages for ${jids.length} chats`);

  for (const jid of jids) {
    if (jid === "status@broadcast") continue;

    const msgArray = store.messages[jid]?.array || [];
    const recent = msgArray.filter((msg) => {
      const ts = Number(msg.messageTimestamp) * 1000;
      return ts > since && !msg.key.fromMe;
    });

    if (recent.length === 0) continue;

    const chat = store.chats.get(jid);
    const isGroup = jid.endsWith("@g.us");
    const chatName = chat?.name || jid.split("@")[0];

    results.push({
      chatName,
      isGroup,
      messages: recent.map((msg) => {
        const ts = Number(msg.messageTimestamp) * 1000;
        const senderJid = msg.key.participant || msg.key.remoteJid;
        const contact = store.contacts[senderJid];
        const from =
          msg.pushName ||
          contact?.notify ||
          contact?.name ||
          senderJid?.split("@")[0] ||
          "Unknown";
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
