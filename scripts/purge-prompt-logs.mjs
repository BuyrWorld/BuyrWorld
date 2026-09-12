#!/usr/bin/env node
/**
 * Purge the stored prompt logs from Upstash.
 *
 * The code stopped writing these in commit 790be1f, but everything written
 * before that is still there — the first 600 characters of every user prompt,
 * one list per day, with no expiry. Until this runs, the audit's critical
 * finding is only half closed.
 *
 * This script cannot be run for you: it needs the credentials, which live in
 * the hosting project's environment and are deliberately not in this repo.
 *
 * Usage (from the repository root):
 *
 *   # 1. See what is there. Deletes nothing.
 *   UPSTASH_REDIS_REST_URL="https://..." \
 *   UPSTASH_REDIS_REST_TOKEN="..." \
 *   node scripts/purge-prompt-logs.mjs
 *
 *   # 2. Delete it.
 *   UPSTASH_REDIS_REST_URL="https://..." \
 *   UPSTASH_REDIS_REST_TOKEN="..." \
 *   node scripts/purge-prompt-logs.mjs --confirm
 *
 * Get the two values from the hosting project's environment variables, or from
 * the Upstash console. AFTER this succeeds, rotate the Upstash token, the admin
 * key and the model API key, then delete both variables from the hosting
 * project — nothing in the codebase references them any more.
 *
 * The script never prints stored prompt content. It reports counts only, so
 * running it does not itself put the data on your screen or in your shell
 * history.
 */

const URL_ = process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const CONFIRM = process.argv.includes("--confirm");

if (!URL_ || !TOKEN) {
  console.error(
    "\nMissing credentials.\n\n" +
    "  UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN must both be set.\n" +
    "  See the header of this file for the exact command.\n"
  );
  process.exit(2);
}

const base = URL_.replace(/\/+$/, "");

async function redis(path) {
  const r = await fetch(`${base}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`Upstash returned ${r.status} for ${path.split("/")[0]}`);
  return (await r.json()).result;
}

async function main() {
  console.log(`\nUpstash: ${base.replace(/\/\/([^.]+)/, "//****")}`);
  console.log(CONFIRM ? "Mode: DELETE\n" : "Mode: dry run — nothing will be deleted\n");

  // Prompt logs were written as one list per day: prompts:YYYY-MM-DD
  const keys = await redis("keys/prompts:*");
  if (!Array.isArray(keys) || keys.length === 0) {
    console.log("No prompts:* keys found. Nothing to purge.");
    console.log("If you expected data here, check you are pointed at the right database.\n");
    return;
  }

  let total = 0;
  const rows = [];
  for (const key of keys.sort()) {
    const n = Number(await redis(`llen/${encodeURIComponent(key)}`)) || 0;
    total += n;
    rows.push([key, n]);
  }

  console.log(`${keys.length} day(s) of stored prompts, ${total} entries in total:\n`);
  for (const [key, n] of rows) console.log(`  ${key.padEnd(24)} ${String(n).padStart(6)} entries`);

  if (!CONFIRM) {
    console.log(
      `\nDry run. Re-run with --confirm to delete all ${keys.length} key(s) permanently.\n` +
      `This cannot be undone, which is the intention.\n`
    );
    return;
  }

  console.log("\nDeleting…");
  let deleted = 0;
  for (const [key] of rows) {
    await redis(`del/${encodeURIComponent(key)}`);
    deleted++;
  }

  const left = await redis("keys/prompts:*");
  const remaining = Array.isArray(left) ? left.length : 0;

  console.log(`Deleted ${deleted} key(s). Remaining prompts:* keys: ${remaining}`);
  if (remaining === 0) {
    console.log(
      "\nPurge complete. The critical finding is now fully closed.\n\n" +
      "Still to do, in the hosting and Upstash consoles:\n" +
      "  1. Rotate the Upstash token.\n" +
      "  2. Rotate the admin key and the model API key.\n" +
      "  3. Delete UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN from the\n" +
      "     hosting project — nothing in the codebase references them.\n"
    );
  } else {
    console.log("\nSome keys remain. Re-run to finish.\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`\nFailed: ${e.message}\n`);
  process.exit(1);
});
