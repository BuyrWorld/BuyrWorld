# Putting it back

The v5 pack asks for *"exact rollback steps"* with every phase, and this
repository had none written down. Pushing to `main` deploys production, which
makes the question "and how do I undo that" one somebody will ask at the worst
possible moment.

Recorded 18 September 2026, against `main` at the end of v5 Phase 5.

## The two ways, and which to use

**Revert the commit, push, let it deploy.** Slower by a minute or two, and the
repository and production agree with each other afterwards.

```
git revert --no-edit <sha>        # or <first>^..<last> for a run of them
node scripts/verify.mjs           # it must still pass; a revert can break a test
git push origin main
```

**Promote an earlier deployment in Vercel.** Faster, and the right choice when
the site is actually broken. Vercel → project `buyr-world` → Deployments →
the last good one → **Promote to Production**.

It leaves production and `main` disagreeing until you also revert the commit,
so do the revert afterwards rather than instead. A deploy from any other cause
— somebody merging anything — will otherwise put the broken build straight
back.

## What a rollback does not undo

Every v5 phase was additive: no store changed meaning, and no existing figure
moved. What a rollback cannot reach is what is already in somebody's browser.

| Rolled back to before | Already stored | What the older build does |
|---|---|---|
| Phase 1 (`8db95e5`) | Studio scenarios at schema 3 | Reads schemas 1–3, so they still open. A build older than schema 3 withholds them and says which schema wrote them — nothing is deleted, and re-deploying forward makes them readable again. |
| Phase 4 (`e54c853`) | `bw.calls.v1` | The older build never reads that key. The notes stay where they are, untouched and invisible, until a build that knows about them is deployed again. |
| Phase 5 (`b51c517`) | Review packages already downloaded | `part-model.json` written after Phase 5 says `buyrworld-part-model/1`. An older build has no reader at all — it only ever wrote them — so nothing breaks; a newer file simply cannot be opened by an older tool. |

Nothing in any phase deletes or rewrites what an older build stored, which is
why a rollback is safe to do in a hurry and a roll-forward is safe afterwards.

## What to check after either

- The GitHub commit timestamp, not the browser. Cached CDN responses have
  repeatedly shown stale content here.
- An incognito window on `https://www.buyrworld.com/`.
- The engine banner. If `window.BW` failed to load, one sentence at the top of
  the page says so and names what failed; a page that looks fine with two
  empty tables is the failure mode that sentence exists to prevent.
- `node scripts/verify.mjs` locally, if you reverted by hand.

## What has never been rolled back

This procedure has not been used. It is written from how the project is
deployed rather than from an incident, and the Vercel step in particular is
worth walking through once while nothing is on fire.
