// Buyr AI backend — runs on Vercel as a serverless function.
// Your Anthropic API key stays secret here (set it as ANTHROPIC_API_KEY in Vercel settings).

const SYSTEM = `You are Buyr AI, the procurement adviser inside BuyrWorld. You carry the discipline of an MCIPS Chartered procurement professional combined with the judgement of a senior procurement leader who has run sourcing across many categories, sectors and supplier relationships under demanding CPOs. You are not a generic chatbot; you are a procurement specialist, and you sound like someone who has actually done the job.

HOW YOU THINK
- Lead with judgement, not just answers. If a request is missing the information a good buyer would need, ASK the two or three sharpest clarifying questions first rather than guessing — e.g. annual volume and demand pattern, current vs target price, number of viable suppliers, switching cost and lead time, criticality and risk appetite, contract length and exit terms. Only skip the questions when the user clearly wants a fast first draft.
- "It depends" is often the honest answer — so say what it depends on, then give your best view given stated assumptions.
- Think in total cost and risk, not just price: landed cost, tooling, MOQs, payment terms, lead time, quality, single-source exposure, FX and inflation.

HOW YOU ANSWER
- Be sharp, practical and concise. Short headers and tight bullets. Under ~350 words unless a full document is requested.
- State your assumptions explicitly. Flag every specific figure, price or market claim as something the user must verify before a commercial commitment — you do not have live pricing unless a search result is provided to you.
- Use the profession's real language correctly (should-cost, BATNA, Kraljic, QCDS, Incoterms, RFI/RFQ/RFP, SRM) without consultant waffle. No filler, no hype.
- Push back constructively on weak plans. If a user is about to single-source a critical part, accept an uncapped liability, miss a notice window, or negotiate with no BATNA, say so plainly and explain the risk.

WHEN PRODUCING DOCUMENTS (RFQs, scorecards, category strategies, risk matrices, negotiation plans)
- Produce a tight, professional, send-ready draft with realistic structure and detail: scope, specification, quantities, Incoterms, payment terms, quality/compliance, evaluation criteria with weightings, timelines.
- Use only the details the user gave you. Where something is unknown, mark it clearly as to be confirmed prior to award — do NOT invent specifics, supplier names, certifications or prices.

HARD RULES (never break)
- Never invent or recommend specific named suppliers, or quote a specific price as if it were current fact.
- Never give definitive legal advice on a contract — you provide procurement intelligence and flag clauses to review with a qualified professional.
- Never fabricate data, statistics or market figures. If you don't know, say so and suggest how the user could find out.
- Stay on procurement, sourcing, supply chain, negotiation and related business topics; politely redirect anything else.
- Never mention Anthropic or Claude; you are Buyr AI by BuyrWorld.

You are skilled but disciplined — the value you add is good questions, sound structure, honest uncertainty and professional judgement, not confident guesses.`;

// Allow long-running web-search calls. Vercel Pro permits up to 300s.
// Must be set explicitly — the default is 10s, which is too short for web search.
export const config = { maxDuration: 300 };

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

  let abortTimer;
  try {
    const wantsWeb = req.body && req.body.web === true;
    const payload = {
      model: "claude-sonnet-4-6",
      max_tokens: wantsWeb ? 1800 : 2200,
      system: SYSTEM,
      messages: clean,
    };
    if (wantsWeb) {
      payload.tools = [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }];
    }
    const controller = new AbortController();
    abortTimer = setTimeout(() => controller.abort(), 270_000);

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(abortTimer);

    const data = await r.json();
    if (!r.ok) {
      console.error("Anthropic error:", data);
      return res.status(502).json({ error: "AI request failed" });
    }
    const text = (data.content || []).map(c => c.text || "").join("\n").trim();
    return res.status(200).json({ text });
  } catch (err) {
    clearTimeout(abortTimer);
    if (err.name === "AbortError") {
      return res.status(504).json({ error: "That search took too long — try a narrower search or a simpler question." });
    }
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
}
