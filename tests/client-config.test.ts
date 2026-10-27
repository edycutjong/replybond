import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { MAINNET_PROOF_TIMEOUT_TX, networkLabel, proofTimeoutTx } from '../src/lib/proof'
import { orderLogs } from '../src/lib/pageLogs'

test('proofTimeoutTx: mainnet defaults to job 6, an override wins, every other chain has none', () => {
  assert.equal(proofTimeoutTx(5042, undefined), MAINNET_PROOF_TIMEOUT_TX)
  assert.equal(MAINNET_PROOF_TIMEOUT_TX, '0x7312e5db712a360e5b582e0f0afa0a9b96e4ce228d89036d6fcd5aae26783a77')
  const mine = `0x${'ab'.repeat(32)}`
  assert.equal(proofTimeoutTx(5042, mine), mine)
  assert.equal(proofTimeoutTx(5042002, mine), mine, 'an explicit override works on any chain')
  assert.equal(proofTimeoutTx(5042, 'not a hash'), MAINNET_PROOF_TIMEOUT_TX, 'an invalid override is ignored')
  assert.equal(proofTimeoutTx(5042002, undefined), null, 'testnet: nothing pinned, no read attempted')
  assert.equal(proofTimeoutTx(5042002, '0x1234'), null)
  assert.equal(proofTimeoutTx(1, undefined), null)
})

test('networkLabel: "Arc mainnet" and "Arc testnet", no doubled suffix', () => {
  assert.equal(networkLabel(5042, 'Arc', false), 'Arc mainnet')
  assert.equal(networkLabel(5042002, 'Arc Testnet', true), 'Arc testnet')
  assert.equal(networkLabel(84532, 'Base Sepolia', true), 'Base Sepolia testnet')
  assert.equal(networkLabel(11155111, 'Ethereum Sepolia', true), 'Ethereum Sepolia testnet')
  assert.equal(networkLabel(8453, 'Base', false), 'Base')
})

test('orderLogs: shuffled input with one duplicate comes back sorted and deduped', () => {
  const log = (blockNumber: bigint, logIndex: number, tx: string) => ({ blockNumber, logIndex, transactionHash: tx })
  const a = log(10n, 0, '0xa')
  const b = log(10n, 3, '0xa')
  const c = log(11n, 1, '0xb')
  const d = log(12n, 0, '0xc')
  const out = orderLogs([d, b, c, a, { ...b }])
  assert.deepEqual(out, [a, b, c, d])
  assert.equal(orderLogs([]).length, 0)
})

test('mainnet proof config holds exactly the verified values', async () => {
  const { MAINNET_PROOF, sourcifyUrl } = await import('../src/lib/proof')
  assert.equal(MAINNET_PROOF.chainId, 5042)
  assert.equal(MAINNET_PROOF.contract, '0x2a0f4aeF8E5379d8E4606F40846cf97716fe749f')
  assert.deepEqual(MAINNET_PROOF.txs, {
    postOffer: '0xaf44d46742f2450b970cee9be66f67a17bcec622f7397a381a4420d362bb9911',
    acceptOffer: '0xd36045c287853e39482c4a81cabbe1698ce93aede9201aaeb61feb41fb81f51d',
    respond: '0xc41b409017c57c5e1d84ff8a4b382170a536eedd0b2284380f5bb2e308e71093',
    acknowledge: '0xce43ecd7b5470259caf9658accb7197ecd1707a9b24584a978f0e8b3477de338',
    timeout: '0x7312e5db712a360e5b582e0f0afa0a9b96e4ce228d89036d6fcd5aae26783a77',
    claim: '0x2c008eb8e69a417b781d6da6065b2b98d87cb40d2cfd6b950db0fe1a3fe2de6f',
  })
  assert.equal(sourcifyUrl(MAINNET_PROOF.contract), 'https://sourcify.dev/#/lookup/0x2a0f4aeF8E5379d8E4606F40846cf97716fe749f')
  assert.equal(proofTimeoutTx(5042, undefined), MAINNET_PROOF.txs.timeout)
})

test('routeFor: / and unknown paths are the landing page, /app and below are the app', async () => {
  const { routeFor } = await import('../src/lib/route')
  for (const p of ['/app', '/app/', '/app/anything', '/app/a/b']) assert.equal(routeFor(p), 'app', p)
  for (const p of ['/', '', '/application', '/apps', '/other', '/api/sweep']) assert.equal(routeFor(p), 'landing', p)
})

test('proofSteps: every step carries its result, with figures taken from the job terms', async () => {
  const { MAINNET_PROOF, proofSteps } = await import('../src/lib/proof')
  const { BOND, PRICE } = await import('../src/lib/terms')
  const fmt = (raw: bigint) => `<${raw}>`
  const steps = proofSteps(fmt)
  assert.deepEqual(steps.map((s) => s.name), ['postOffer', 'acceptOffer', 'respond', 'acknowledge', 'timeout', 'claim'])
  for (const s of steps) assert.equal(s.hash, MAINNET_PROOF.txs[s.name])
  const total = fmt(PRICE + BOND)
  assert.deepEqual(steps.map((s) => s.result), [
    `provider posts a ${fmt(BOND)} bond`,
    `buyer pays ${fmt(PRICE)}`,
    'answer written onchain',
    `provider paid ${total}`,
    `buyer +${total}`,
    `provider +${total}, buyer silent`,
  ])
  // with the page's real formatter the demo figures read 0.005, 0.010 and 0.015
  const real = proofSteps((raw) => (Number(raw) / 1e18).toFixed(3))
  assert.deepEqual(real.map((s) => s.result), ['provider posts a 0.005 bond', 'buyer pays 0.010', 'answer written onchain', 'provider paid 0.015', 'buyer +0.015', 'provider +0.015, buyer silent'])
})

test('heroCaption: pinned proof says so with its job, a live run points at the proof set', async () => {
  const { MAINNET_PROOF, heroCaption } = await import('../src/lib/proof')
  const pinned = MAINNET_PROOF.txs.timeout
  assert.equal(heroCaption({ shownTx: pinned, pinnedTx: pinned, jobId: '6', proofCount: 6 }), 'This is the pinned proof settlement (job 6).')
  assert.equal(heroCaption({ shownTx: pinned.toUpperCase().replace('0X', '0x'), pinnedTx: pinned, jobId: '6', proofCount: 6 }), 'This is the pinned proof settlement (job 6).')
  assert.equal(
    heroCaption({ shownTx: `0x${'ab'.repeat(32)}`, pinnedTx: pinned, jobId: '9', proofCount: 6 }),
    'Latest live run shown above. The fixed six-transaction proof set is further down.',
  )
  assert.equal(heroCaption({ shownTx: `0x${'ab'.repeat(32)}`, pinnedTx: null, jobId: '9', proofCount: null }), 'Latest live run shown above.')
  assert.equal(heroCaption({ shownTx: null, pinnedTx: pinned, jobId: null, proofCount: 6 }), null)
})
