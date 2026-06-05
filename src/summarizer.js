const Anthropic = require("@anthropic-ai/sdk");

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a concise WhatsApp daily digest assistant for a single user.
In the message data, "Me" means the user themselves sent that message.

For each chat, summarise what happened in 1-3 bullet points. Focus on:
- Messages from others that need a reply or contain important info
- Decisions, plans, or action items (regardless of who raised them)
- The overall topic/mood of the conversation

Format rules (Telegram markdown):
- *Chat name* as the header for each chat
- Plain bullet points (-)
- Skip chats where nothing meaningful happened (only greetings, reactions, memes)
- If the user was the only one speaking, note it briefly ("You sent a message, no reply yet")

End with a one-line "📋 Summary" listing any chats that need a response.`;

async function summarize(chats) {
  if (chats.length === 0) return "No new messages in the last 24 hours.";

  const content = chats
    .map((chat) => {
      const label = chat.isGroup ? `[Group] ${chat.chatName}` : `[Chat] ${chat.chatName}`;
      const msgs = chat.messages.map((m) => `  ${m.time} ${m.from}: ${m.body}`).join("\n");
      return `${label}\n${msgs}`;
    })
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      {
        role: "user",
        content: `Summarize these WhatsApp messages from the last 24 hours:\n\n${content}`,
      },
    ],
  });

  return response.content[0].text;
}

module.exports = { summarize };
