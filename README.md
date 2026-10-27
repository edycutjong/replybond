# ReplyBond

Pay an API per call: if it misses its onchain deadline, you get your price back plus the provider's bond. The app is a one-page counter at `/` where you can settle a missed deadline, call the demo API with your own wallet, watch a demo job miss its deadline, or watch the buyer stay silent after the answer (the provider then claims), and follow every job live from the contract's events. It also includes a small `POST /api/probe` route that sends a 0-value transaction from a configured wallet to itself.

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

The `api/` folder holds Vercel-style functions that also run in the local preview: `/api/job`, `/api/sweep`, `/api/demo-run`, `/api/offer`, `/api/settle` and `/api/demo-refill`. They let visitors run a paid job with no wallet, settle missed deadlines, and keep a small pool of expired jobs ready. A daily cron (see `vercel.json`) tops the pool up. Set the variables below in Vercel project settings when deploying.

### Environment variables

Hosted on Vercel (Vite framework preset, `api/` as Node.js functions):

Server (Vercel project environment variables, runtime):
- `PROVIDER_KEY`: private key of the service-provider wallet. Required.
- `DEMO_BUYER_KEY`: private key of the demo buyer wallet. Required.
- `VITE_PROVIDER_ADDRESS`, `VITE_DEMO_BUYER_ADDRESS` (optional): the provider and demo-buyer addresses, so the page can list the provider's jobs and collapse stock without waiting for the sweep.
- `VITE_PROOF_TIMEOUT_TX` (optional): a settled timeout shown in the hero, labelled "On record", when the recent scan holds none. On Arc mainnet it defaults to a real mainnet timeout.
- `RPC_URL`: RPC endpoint for the configured chain. Required in production; a missing value returns a clear 500.
- `CRON_SECRET` (optional, recommended in production): when set, the daily pool-rotation job must send it as a bearer token; Vercel Cron does this automatically. Without it the daily job only tops the pool up.
- `REPLYBOND_ADDRESS`: optional override of `VITE_REPLYBOND_ADDRESS` for the API.
- `REPLYBOND_START_BLOCK`: optional override of `VITE_REPLYBOND_START_BLOCK` for the API.

Shared config (set as Vercel environment variables; read by the build and by the functions):
- `VITE_CHAIN_ID`: chain the app and API use. Required in production.
- `VITE_REPLYBOND_ADDRESS`: deployed ReplyBond address. Required in production.
- `VITE_REPLYBOND_START_BLOCK`: block the contract was deployed in. Required in production.

Optional at build time:
- `VITE_STUDIO_PROJECT_URL`: Arc Studio project link in the header.
- `VITE_SITE_URL`: public origin for the social card image (defaults to the Vercel production URL).

Local only:
- `PROBE_KEY`: private key for the sample `/api/probe` route (local `server/` process).
- `PROBE_SERVER_PORT`: optional port for that local process (default 3001).
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: provisioned by Arc Studio previews; optional elsewhere.

