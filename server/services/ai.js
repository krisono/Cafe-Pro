const OpenAI = require('openai');

let client;

function getClient() {
  if (!client) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI Key is not set in the .env file');
    }
    client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return client;
}

async function generateDailyBrief(snapshot) {
  const { items, urgentBatches, recentUsage } = snapshot;

  const prompt = `You are an AI assistant for a small cafe's inventory system called CafePro.
Analyze the following inventory data and generate a concise daily brief.

Inventory snapshot:
${JSON.stringify({ items, urgentBatches, recentUsage }, null, 2)}

Today's date: ${new Date().toISOString().split('T')[0]}

Your brief should include:
1. URGENT: Items expiring within 2 days — suggest using them immediately
2. THIS WEEK: Items expiring within 7 days — suggest menu specials to use them
3. REORDER: Items below their reorder threshold
4. WASTE INSIGHT: Any patterns you notice (e.g., consistently over-ordering something)

Keep it conversational and actionable. You're talking to a busy cafe owner.
Respond ONLY with valid JSON in this exact format:
{
  "urgent": [{ "item": "...", "batch_qty": "...", "expires": "...", "suggestion": "..." }],
  "this_week": [{ "item": "...", "batch_qty": "...", "expires": "...", "suggestion": "..." }],
  "reorder": [{ "item": "...", "current_qty": "...", "reorder_point": "...", "suggestion": "..." }],
  "waste_insight": "..."
}`;

  const completion = await getClient().chat.completions.create(
    {
      model: 'gpt-4o',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    },
    { timeout: 25000 }
  );

  const text = completion.choices[0].message.content.trim();
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

async function estimateShelfLife({ name, category, date }) {
  const prompt = `You are a food safety assistant. Given the following item, estimate a
reasonable expiration date from today's date.

Item: ${name}
Category: ${category}
Today's date: ${date}

Respond ONLY with valid JSON in this exact format:
{
  "estimated_days": <number>,
  "expiration_date": "<ISO date YYYY-MM-DD>",
  "confidence": "high" | "medium" | "low",
  "reasoning": "<one sentence>"
}`;

  const completion = await getClient().chat.completions.create({
    model: 'gpt-4o',
    max_tokens: 256,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = completion.choices[0].message.content.trim();
  const json = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  return JSON.parse(json);
}

module.exports = { generateDailyBrief, estimateShelfLife };
