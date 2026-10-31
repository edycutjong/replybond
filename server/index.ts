import { createServer } from 'node:http'
import { createPublicClient, createWalletClient, http, isHex, parseGwei } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { arcTestnet } from 'viem/chains'
import { requireChain } from '../src/onchain-facts'

const PORT = Number(process.env.PROBE_SERVER_PORT ?? 3001)
const MIN_MAX_FEE = parseGwei('20')

const rpcUrl = requireChain(arcTestnet.id).rpcUrls[0]

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function probe(): Promise<Response> {
  const raw = process.env.PROBE_KEY?.trim()
  if (!raw) return json({ error: 'PROBE_KEY is not set in the environment' }, 500)

  const key = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!isHex(key) || key.length !== 66) {
    return json({ error: 'PROBE_KEY is not a valid 32-byte hex private key' }, 500)
  }

  try {
    const account = privateKeyToAccount(key)
    const transport = http(rpcUrl)
    const publicClient = createPublicClient({ chain: arcTestnet, transport })
    const walletClient = createWalletClient({ account, chain: arcTestnet, transport })

    const est = await publicClient.estimateFeesPerGas()
    const maxFeePerGas = est.maxFeePerGas > MIN_MAX_FEE ? est.maxFeePerGas : MIN_MAX_FEE
    const maxPriorityFeePerGas =
      est.maxPriorityFeePerGas > maxFeePerGas ? maxFeePerGas : est.maxPriorityFeePerGas

    const hash = await walletClient.sendTransaction({
      account,
      chain: arcTestnet,
      to: account.address,
      value: 0n,
      maxFeePerGas,
      maxPriorityFeePerGas,
    })

    return json({
      hash,
      from: account.address,
      to: account.address,
      maxFeePerGas: maxFeePerGas.toString(),
      maxPriorityFeePerGas: maxPriorityFeePerGas.toString(),
    })
  } catch (err) {
    // The details stay in the server log; the caller gets a fixed message.
    console.error('probe failed', err)
    return json({ error: 'probe failed; see the server log' }, 500)
  }
}

createServer((req, res) => {
  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
  // Vite strips the /api prefix before proxying, so accept both forms.
  const respond = (r: Response | Promise<Response>) =>
    Promise.resolve(r).then(async (out) => {
      res.writeHead(out.status, Object.fromEntries(out.headers))
      res.end(await out.text())
    })
  if (pathname === '/probe' || pathname === '/api/probe') {
    void respond(
      req.method === 'POST' ? probe() : json({ error: 'Method not allowed, use POST' }, 405),
    )
    return
  }
  void respond(json({ error: 'Not found' }, 404))
}).listen(PORT, () => {
  console.log(`probe server listening on :${PORT}`)
})
