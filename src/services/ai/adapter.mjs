/**
 * The model adapter.
 *
 * One interface, two implementations: a mock for tests and an HTTP transport
 * that goes through this site's own serverless function. Nothing else in the
 * codebase talks to a model directly, so the rules below hold everywhere:
 *
 *   - Output is JSON, parsed and validated at runtime.
 *   - Invalid JSON is a visible error state. Never a silent fallback that
 *     fabricates a plausible-looking success — that is the failure mode that
 *     makes a system untrustworthy rather than merely broken.
 *   - Prompts are versioned, so a change can be attributed.
 *   - Nothing here logs prompt or document content.
 */

/** Every prompt carries a version, so an evaluation result can be attributed. */
export const PROMPT_VERSION = "claim-extract/2026-09-13";

export const FAILURE = Object.freeze({
  TRANSPORT: "transport-failed",
  NOT_JSON: "response-was-not-json",
  WRONG_SHAPE: "response-json-had-the-wrong-shape",
  EMPTY: "response-was-empty",
});

/**
 * @param {object} opts
 * @param {(prompt: string, o?: object) => Promise<string>} opts.transport
 * @param {string} [opts.promptVersion]
 */
export function createAdapter({ transport, promptVersion = PROMPT_VERSION } = {}) {
  if (typeof transport !== "function") {
    throw new TypeError("An adapter needs a transport function");
  }

  return Object.freeze({
    promptVersion,

    /**
     * Ask for JSON and insist on getting it.
     * @returns {Promise<{ok: true, data: object, raw: string} | {ok: false, failure: string, detail: string, raw: string}>}
     */
    async json(prompt, options = {}) {
      let raw;
      try {
        raw = await transport(prompt, options);
      } catch (e) {
        return fail(FAILURE.TRANSPORT, e?.message ?? String(e), "");
      }

      if (typeof raw !== "string" || raw.trim() === "") {
        return fail(FAILURE.EMPTY, "The model returned nothing.", raw ?? "");
      }

      const text = stripFence(raw);
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return fail(FAILURE.NOT_JSON, e?.message ?? "unparseable", raw);
      }
      if (data === null || typeof data !== "object" || Array.isArray(data)) {
        return fail(FAILURE.WRONG_SHAPE, "Expected a JSON object at the top level.", raw);
      }
      return Object.freeze({ ok: true, data, raw });
    },
  });
}

function fail(failure, detail, raw) {
  return Object.freeze({ ok: false, failure, detail, raw });
}

/** Models habitually wrap JSON in a markdown fence. Tolerate that, nothing more. */
export function stripFence(text) {
  const t = String(text).trim();
  const fenced = t.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  return (fenced ? fenced[1] : t).trim();
}

/* ------------------------------------------------------------- transports */

/**
 * For tests and for demonstrating a failure path. Accepts a string, an array of
 * strings to return in order, or a function.
 */
export function mockTransport(scripted) {
  if (typeof scripted === "function") return scripted;
  if (Array.isArray(scripted)) {
    let i = 0;
    return async () => {
      const next = scripted[Math.min(i, scripted.length - 1)];
      i++;
      if (next instanceof Error) throw next;
      return next;
    };
  }
  return async () => {
    if (scripted instanceof Error) throw scripted;
    return scripted;
  };
}

/**
 * The real one. Goes through this site's serverless function so the API key
 * stays server-side, and surfaces a partial or failed response rather than
 * pretending it succeeded.
 */
export function httpTransport({ endpoint = "/api/chat", fetchImpl } = {}) {
  const f = fetchImpl ?? globalThis.fetch;
  return async (prompt) => {
    const res = await f(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`The model endpoint returned ${res.status}`);
    const body = await res.json();
    if (body.partial) throw new Error("The model's answer was cut short, so the extraction is incomplete.");
    return body.text || "";
  };
}
