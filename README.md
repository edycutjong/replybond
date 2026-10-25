# ReplyBond

Pay an API per call: if it misses its onchain deadline, you get your price back plus the provider's bond. The app is a one-page counter at `/` where you can settle a missed deadline, call the demo API with your own wallet, watch a demo job miss its deadline, and follow every job live from the contract's events. It also includes a small `POST /api/probe` route that sends a 0-value transaction from a configured wallet to itself.

Built with [Arc Studio](https://studio.arc.io)

## ReplyBond contract

`contracts/ReplyBond.sol` is a pay-per-job agreement on Arc: a provider posts a penalty bond, a buyer pays the price, and the provider must publish its answer onchain before a deadline. If it does, the provider is paid price plus bond. If it does not, the buyer gets price plus bond. It proves on-time delivery, not that the answer is correct, and outputs are public. Run its tests with `bun run contracts:test`.

## Tech stack

Vite, React, TypeScript, Tailwind CSS, viem, wagmi, Bun.

## Development

Prerequisites: [Bun](https://bun.sh).

```
bun install
bun run server   # probe API on port 3001
bun run dev      # app on port 5173, proxies /api to the probe API
```

Call it: `curl -X POST http://localhost:5173/api/probe`

Other commands: `bun run check` (lint and typecheck), `bun run test:offers` (fixture hash and receipt classification tests), `bun run contracts:test` (contract tests).

### Serverless API

The `api/` folder holds Vercel-style functions that also run in the local preview: `/api/job`, `/api/sweep`, `/api/demo-run`, `/api/offer`, `/api/settle` and `/api/demo-refill`. They let reviewers run a paid job with no wallet, settle missed deadlines, and keep a small pool of expired jobs ready. A daily cron (see `vercel.json`) tops the pool up. Set the variables below in Vercel project settings when deploying.

### Environment variables

- `VITE_CHAIN_ID`: chain the app and API use (defaults to Arc Testnet). Changing the network is a config change.
- `VITE_REPLYBOND_ADDRESS`: deployed ReplyBond address shown and read by the page (also used by the API when `REPLYBOND_ADDRESS` is unset).
- `VITE_REPLYBOND_START_BLOCK`: optional, first block to scan for events (the deployment block).
- `VITE_STUDIO_PROJECT_URL`: optional, Arc Studio project link in the header.
- `VITE_SITE_URL`: optional, public site origin (no trailing slash) used for the social card image URL.
- `PROVIDER_KEY`: private key of the service-provider wallet (funded with Arc Testnet USDC). Required by `api/`.
- `DEMO_BUYER_KEY`: private key of the demo buyer wallet (funded with Arc Testnet USDC). Required by `api/`.
- `REPLYBOND_ADDRESS`: optional, ReplyBond contract address (defaults to the Arc Testnet deployment).
- `REPLYBOND_START_BLOCK`: optional, first block to scan for events (defaults to the deployment block).
- `RPC_URL`: optional, Arc Testnet RPC endpoint (defaults to the public Arc Testnet RPC).
- `PROBE_KEY`: private key (0x-prefixed hex) of a funded Arc Testnet wallet used to send the probe transaction. Required for `/api/probe`.
- `PROBE_SERVER_PORT`: optional, port for the probe API (default 3001).
