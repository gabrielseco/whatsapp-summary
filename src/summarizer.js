const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are a concise WhatsApp daily digest assistant.
Given messages from the last 24 hours, produce a clear summary grouped by chat.
Highlight anything that needs a response, action items, or important updates.
Keep it brief. Use Telegram markdown: *bold* for chat names, plain bullet points.
Skip chats with only trivial messages (memes, stickers, reactions).`;

async function summarize(chats) {
  if (chats.length === 0) return 'No new messages in the last 24 hours.';

  const content = chats
    .map((chat) => {
      const label = chat.isGroup ? `[Group] ${chat.chatName}` : `[Chat] ${chat.chatName}`;
      const msgs = chat.messages
        .map((m) => `  ${m.time} ${m.from}: ${m.body}`)
        .join('\n');
      return `${label}\n${msgs}`;
    })
    .join('\n\n');

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Summarize these WhatsApp messages from the last 24 hours:\n\n${content}`,
      },
    ],
  });

  return response.content[0].text;
}

module.exports = { summarize };
