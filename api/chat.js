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

const MODEL = "claude-sonnet-4-6";

// Content-free request telemetry. Never log prompt text, document text or any
// user input — metadata only. See CLAUDE.md, post-audit rules.
function telemetry(fields) {
  console.log("REQ", JSON.stringify(fields));
}

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

  // ---- Request telemetry (metadata only, never content) ----
  const reqId = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  const started = Date.now();
  const wantsWeb = req.body && req.body.web === true;
  const inputChars = clean.reduce((n, m) => n + m.content.length, 0);
  // Did the 18k per-message cap above actually bite? Observable, not silent.
  const inputCut = messages.some(m => typeof m.content === "string" && m.content.length > 18000);
  const log = (status, extra) => telemetry({
    id: reqId,
    t: new Date().toISOString(),
    tool: wantsWeb ? "web" : "chat",
    model: MODEL,
    turns: clean.length,
    chars: inputChars,
    cut: inputCut,
    ms: Date.now() - started,
    status,
    ...extra,
  });

  let abortTimer;
  try {
    const payload = {
      model: MODEL,
      max_tokens: wantsWeb ? 3000 : 2200,
      system: SYSTEM,
      messages: clean,
    };
    if (wantsWeb) {
      payload.tools = [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }];
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
      log(502, { err: data?.error?.type || "upstream_error" });
      return res.status(502).json({ error: "AI request failed" });
    }
    const blocks = data.content || [];
    const text = blocks.map(c => c.text || "").join("\n").trim();

    // Sources, deduped by URL. A block Claude actually cited is marked cited:true;
    // remaining search hits are returned uncited so the UI can still show its working.
    const byUrl = new Map();
    for (const b of blocks) {
      for (const c of b.citations || []) {
        if (c.url) byUrl.set(c.url, { url: c.url, title: c.title || c.url, cited: true });
      }
    }
    // Server-tool failures arrive as HTTP 200 with an error OBJECT where a list of
    // results would normally be — branch on that before iterating.
    let searchError = null;
    for (const b of blocks) {
      if (b.type !== "web_search_tool_result") continue;
      if (!Array.isArray(b.content)) { searchError = b.content?.error_code || "search_failed"; continue; }
      for (const hit of b.content) {
        if (hit.url && !byUrl.has(hit.url)) {
          byUrl.set(hit.url, { url: hit.url, title: hit.title || hit.url, cited: false });
        }
      }
    }
    const sources = [...byUrl.values()];

    // An answer cut short by the token cap, or left paused mid-tool-use, is a partial
    // answer. Say so rather than returning it as though it were complete.
    const partial = data.stop_reason === "max_tokens" || data.stop_reason === "pause_turn";

    log(200, { out: text.length, src: sources.length, stop: data.stop_reason, searchErr: searchError });
    return res.status(200).json({ text, sources, partial, searchError });
  } catch (err) {
    clearTimeout(abortTimer);
    if (err.name === "AbortError") {
      log(504, { err: "AbortError" });
      return res.status(504).json({ error: "That search took too long — try a narrower search or a simpler question." });
    }
    log(500, { err: err?.name || "Error" });
    return res.status(500).json({ error: "Server error" });
  }
}
