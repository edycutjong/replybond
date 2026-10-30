# Contributing to ReplyBond

Thanks for taking a look. ReplyBond is a small project: one Solidity contract, a Vite and React app, and a handful of Vercel Node.js functions in `api/`.

## Setup

You need [Bun](https://bun.sh) (the version in `.bun-version`) and [Foundry](https://book.getfoundry.sh) (the version in `.foundry-version`).

```bash
bun install
cp .env.example .env     # fill in the placeholders you need
bun run dev              # Vite on http://localhost:5173; the api/ functions run in the dev server
```

## Before you open a pull request

```bash
bun run check            # lint + typecheck
bun test tests/          # app and API tests (no network)
forge test               # contract tests
bun run build            # production build
```

All of these run in CI on every pull request.

## Rules of thumb

- Keep changes small and focused. One concern per pull request.
- Add or update a test with every behaviour change.
- Do not commit secrets, `.env` files or private keys. A gitleaks scan runs on every push.
- `contracts/ReplyBond.sol` is deployed on Arc mainnet and has no owner and no upgrade path. Changes to it need a strong reason and a new deployment, so open an issue first.
- Docs and the README quote real numbers (test counts, addresses, hashes). If you change one, change every place that repeats it.

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org): `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`, `ci:`. Keep the subject under 72 characters and say what changed, not how.

## Conduct

Be kind. See the [Code of Conduct](CODE_OF_CONDUCT.md).
