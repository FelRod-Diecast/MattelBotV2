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
