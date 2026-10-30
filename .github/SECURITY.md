# Security Policy

## Reporting a vulnerability

Please report security problems privately. Do not open a public issue.

- Use GitHub's private vulnerability reporting: open the **Security** tab of this repository and choose **Report a vulnerability**.
- Or email edy.cu@live.com with a description, the steps to reproduce, and any proof of concept.

You will get an acknowledgement as soon as the report is read. Please give a reasonable time to fix a problem before you disclose it.

## Scope

- `contracts/ReplyBond.sol`. It has **no owner and no upgrade path**: nobody can pause it, change its parameters or move funds out of it other than through its own functions. A flaw in it cannot be patched in place; the fix is a new deployment.
- The `api/` functions and the web app in `src/`.

The demo wallets behind the live site hold small amounts of USDC for demonstration only. Reports about draining them through the rate limits are welcome, but the amounts at stake are small by design.

## Out of scope

- Findings that need a leaked private key or a compromised hosting account.
- The demo provider answering with its input in capitals: it is an echo service on purpose.
- The contract proving delivery on time, not that an answer is correct. That limit is documented in the README.
