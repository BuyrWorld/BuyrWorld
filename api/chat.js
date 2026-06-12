// Buyr AI backend — runs on Vercel as a serverless function.
// Your Anthropic API key stays secret here (set it as ANTHROPIC_API_KEY in Vercel settings).

const SYSTEM = `You are Buyr AI, the procurement assistant inside BuyrWorld — a platform for buyers, sourcing managers and supply chain teams. Be sharp, practical and concise. Use short headers and bullet lists. When asked for documents (RFQs, scorecards, category strategies, risk matrices, negotiation plans), produce a tight professional draft with realistic procurement detail (specs, Incoterms, payment terms, evaluation criteria, weightings). Keep answers under 350 words unless a full document is requested. Stay on procurement, sourcing, supply chain and business topics; politely redirect anything else. Never mention Anthropic or Claude; you are Buyr AI by BuyrWorld.`;

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const { messages } = req.body || {};
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > 24) {
    return res.status(400).json({ error: "Invalid messages" });
  }

  // Basic shape check so only simple chat turns reach the API
  const clean = messages
    .filter(m => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map(m => ({ role: m.role, content: m.content.slice(0, 18000) }));

  // ---- Prompt logging (owner analytics) ----
  // 1) Always: visible live in Vercel → project → Logs
  // 2) If Upstash env vars are set: stored permanently per day, viewable via /api/logs?key=ADMIN_KEY&day=YYYY-MM-DD
  try {
    const lastUser = [...clean].reverse().find(m => m.role === "user");
    if (lastUser) {
      const entry = { t: new Date().toISOString(), prompt: lastUser.content.slice(0, 600) };
      console.log("PROMPT_LOG", JSON.stringify(entry));
      const U = process.env.UPSTASH_REDIS_REST_URL, T = process.env.UPSTASH_REDIS_REST_TOKEN;
      if (U && T) {
        const day = entry.t.slice(0, 10);
        fetch(`${U}/rpush/prompts:${day}/${encodeURIComponent(JSON.stringify(entry))}`,
          { headers: { Authorization: `Bearer ${T}` } }).catch(() => {});
      }
    }
  } catch (_) {}

  try {
    const wantsWeb = req.body && req.body.web === true;
    const payload = {
      model: "claude-sonnet-4-6",
      max_tokens: wantsWeb ? 3000 : 2200,
      system: SYSTEM,
      messages: clean,
    };
    if (wantsWeb) {
      payload.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }];
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
    });

    const data = await r.json();
    if (!r.ok) {
      console.error("Anthropic error:", data);
      return res.status(502).json({ error: "AI request failed" });
    }
    const text = (data.content || []).map(c => c.text || "").join("\n").trim();
    return res.status(200).json({ text });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
