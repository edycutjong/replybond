# Arc Probe

A small Arc Testnet app with a `POST /api/probe` route that sends a 0-value transaction from a configured wallet to itself (max fee of at least 20 gwei) and returns the transaction hash.

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

Other commands: `bun run check` (lint and typecheck).

### Environment variables

- `PROBE_KEY`: private key (0x-prefixed hex) of a funded Arc Testnet wallet used to send the probe transaction. Required for `/api/probe`.
- `PROBE_SERVER_PORT`: optional, port for the probe API (default 3001).
