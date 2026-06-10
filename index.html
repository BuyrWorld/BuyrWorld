// Owner-only prompt viewer.
// Usage: https://buyrworld.com/api/logs?key=YOUR_ADMIN_KEY            (today)
//        https://buyrworld.com/api/logs?key=YOUR_ADMIN_KEY&day=2026-06-15
// Requires env vars in Vercel: ADMIN_KEY, UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN

export default async function handler(req, res) {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(404).send("Not found"); // looks like nothing exists without the key
  }
  const U = process.env.UPSTASH_REDIS_REST_URL, T = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!U || !T) {
    return res.status(200).json({
      note: "Permanent storage not configured yet. Prompts are still visible live in Vercel → your project → Logs (filter for PROMPT_LOG). To store them per-day, create a free database at upstash.com and add UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN in Vercel → Settings → Environment Variables, then redeploy."
    });
  }
  const day = (req.query.day || new Date().toISOString().slice(0, 10)).slice(0, 10);
  try {
    const r = await fetch(`${U}/lrange/prompts:${day}/0/-1`, { headers: { Authorization: `Bearer ${T}` } });
    const d = await r.json();
    const prompts = (d.result || []).map(x => { try { return JSON.parse(x); } catch { return { raw: x }; } });
    return res.status(200).json({ day, count: prompts.length, prompts });
  } catch (e) {
    return res.status(500).json({ error: "Could not read logs" });
  }
}
