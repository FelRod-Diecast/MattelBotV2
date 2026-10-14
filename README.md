# MattelBotV2

## Project layout

This repository intentionally keeps one production baseline and one active development branch.

- **main** — protected production baseline. Do not change without explicit approval.
- **upcoming-smart-discovery** — active development and release-candidate branch.

## Runtime

Railway starts the bot with:

```text
npm start
→ node production-start.js
→ patches the required production behavior
→ starts bot.js
```

The active runtime uses:

- `bot.js` — core scanner, Discord commands, alerts, inventory/state handling.
- `production-start.js` — production launcher and compatibility fixes.
- `upcoming-discovery.js` — Smart Upcoming Discovery engine.
- `watchlist.json` — watchlist terms.
- `scanData.json` — persistent product state.

Runtime-generated statistics/alert files are not source files and should remain outside version control.

## Scanner behavior

- Five-minute scanning is preserved.
- New-product alerts are protected against repeated notifications.
- Restock and sold-out transitions are tracked.
- Upcoming/pre-order detection uses future launch/ship information.
- Smart Upcoming Discovery checks Mattel source pages and product pages for scheduled launches.
- Discord product alerts can provide direct product/cart links.

## Development rule

Make and test changes on `upcoming-smart-discovery` first. Compare against `main` before proposing anything for production. Never merge or rewrite `main` without explicit approval.

## Discovery work log and hard constraints

Last updated: 2026-10-14

### Non-negotiable repository rules
- Work on `upcoming-smart-discovery` only unless the user explicitly names another development branch.
- `main` is production/sacred. Do not edit, push, merge into, reset, or deploy from `main` without explicit user authorization.
- Do not merge branches or open pull requests against `main` as a shortcut. Test in isolation first; ask separately before any production deployment.
- Do not bring in unrelated commits from another branch. Compare branch ancestry and file diffs before any proposed integration.
- Preserve the working five-minute scan, notification deduplication, launch-date handling, product/cart links, timeouts, startup ordering, and daily summary unless a tested change requires otherwise.
- Inspect existing code and comparable working scanner implementations before making a change. Avoid speculative patches and keep a written record of findings, edits, tests, and unresolved risks.
- Do not claim a live website or Railway test passed when only mocks were used.

### Current issue: upcoming discovery persistence
- Reported products missing from the upcoming list: Hot Wheels RLC Exclusive Datsun 240Z, handle `hot-wheels-rlc-exclusive-datsun-240z-jpm47`; Hot Wheels RLC Exclusive RWB Porsche 930, handle `hot-wheels-rlc-exclusive-rwb-porsche-930-jjy69`.
- The uploaded Railway logs showed the hidden-source scan checking 40 candidates, followed by live-inventory checks reporting both handles as `NOT PURCHASABLE (qty: unknown)`. That inventory result does not establish whether a launch is scheduled.
- Logs also showed an upcoming scan finding one item and a later scan finding zero, plus an `AbortError`. These require separate verification.
- Root issue under investigation: product discovery, launch-date recovery, and live inventory are separate signals. Sold-out/unknown inventory must not erase a valid future launch record; never invent a launch date.
- Current active runtime path documented above: `npm start` → `production-start.js` → `bot.js`; `upcoming-discovery.js` is the Smart Upcoming Discovery engine on this branch.

### Test branch activity and caution
- An isolated branch named `fix/upcoming-persistence-2026-10-13` was created from `upcoming-smart-discovery`. Its discovery-module commits include `1e862a059fad0b17edef7b3a486807bf7afd2d4f`, `685d739775fa73fd99d168db35dae8f1ea1570d7`, and timestamp-guard commit `4a11df4038fe2991247ee737d9c62c745620fb4a`.
- Mock tests passed for JPM47 source-date recovery, restoring a saved RWB future date when `upcoming:false`, excluding a verified purchasable item, duplicate-alert prevention on repeat scan, and module compilation/export preservation. These were mocked tests, not a live Mattel or Railway end-to-end test.
- A pull request against `main` was mistakenly opened as PR #6 and then closed without merging after its ancestry showed 67 commits / 19 changed files relative to `main`. Do not reuse that branch or PR as a merge path. No merge occurred; no Railway deployment was performed as part of that work.
- A further timestamp guard was committed on the isolated test branch; it has not been live-validated.

### Next steps (discovery branch only)
1. Compare the actual `upcoming-smart-discovery` runtime and the working Edge scanner's hidden-product discovery logic before choosing the final integration point.
2. Check how the live launch-calendar HTML associates dates with product handles; nearest-date text matching is only a heuristic until verified against real markup.
3. Add deterministic tests for blank/null timestamps, no valid launch date, inventory-fetch failure, past dates, nearest date among multiple calendar entries, and repeated scans.
4. Test the actual `production-start.js` → `bot.js` startup path and verify no missing-module or patch-order failures.
5. Keep all changes on `upcoming-smart-discovery`; do not merge to `main` or deploy to Railway without separate explicit authorization.
