import assert from 'node:assert/strict'
import { test } from 'node:test'
import { encodeAbiParameters, encodeEventTopics } from 'viem'
import { demoBuyerAddress, providerAddress } from './api-env'
import { NOW, job, normalHash, snap } from './api-helpers'
import demoRunRoute from '../api/demo-run'
import offerRoute from '../api/offer'
import { ctx } from '../api/_lib/config'
import type { Deps } from '../api/_lib/deps'
import { demoRun } from '../api/_lib/flows'
import type { ApiRequest, ApiResponse } from '../api/_lib/http'
import { reusableOffer, walletFloor } from '../api/_lib/state'
import { replyBondAbi, Status } from '../src/lib/abi'
import { BOND, MIN_WALLET_BALANCE_NATIVE, PRICE, bondOf } from '../src/lib/terms'

const HASH = `0x${'ab'.repeat(32)}` as const

/** A chain that answers demoRun with no network: empty history, no pending transactions, and the given balances. */
function chain(balances: { provider: bigint; buyer: bigint }) {
  const sends: { who: string; fn: string; args: readonly unknown[]; value?: bigint }[] = []
  const c = ctx()
  const deps = {
    now: () => NOW * 1000,
    snapshot: async () => snap([]),
    readJob: async () => ({ deadline: NOW + 30 }),
    pub: {
      getBalance: async ({ address }: { address: string }) => (address === c.accounts.provider.address ? balances.provider : balances.buyer),
      getTransactionCount: async () => 0n,
    },
    send: async (who: string, fn: string, args: readonly unknown[], opts?: { value?: bigint }) => {
      sends.push({ who, fn, args, value: opts?.value })
      if (fn !== 'postOffer') return { hash: HASH, receipt: { logs: [] } }
      const topics = encodeEventTopics({ abi: replyBondAbi, eventName: 'OfferPosted', args: { id: 7n, provider: providerAddress, buyer: demoBuyerAddress } })
      const data = encodeAbiParameters([{ type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint64' }, { type: 'uint64' }], [normalHash, PRICE, args[3] === undefined ? 0n : (opts?.value ?? 0n), BigInt(args[3] as bigint), 120n])
      return { hash: HASH, receipt: { logs: [{ address: c.replyBond, topics, data }] } }
    },
  }
  return { sends, deps: deps as unknown as Partial<Deps> }
}
const ONE = 10n ** 18n

test('demo run: the chosen deadline and bond are what the provider posts', async () => {
  const { sends, deps } = chain({ provider: ONE, buyer: ONE })
  const r = await demoRun('silent', deps, { windowS: 30, bond: bondOf('0.010') })
  assert.equal(r.status, 200)
  const post = sends.find((s) => s.fn === 'postOffer')!
  assert.equal(post.args[2], PRICE, 'the price stays 0.010')
  assert.equal(post.args[3], 30n, 'response window')
  assert.equal(post.args[4], 120n, 'grace window unchanged')
  assert.equal(post.value, bondOf('0.010'), 'the bond is msg.value')
  assert.equal(sends.find((s) => s.fn === 'acceptOffer')!.value, PRICE, 'the buyer still pays the price')
  assert.equal(r.body.responseWindow, 30)
  assert.equal(r.body.bond, bondOf('0.010'))
})

test('demo run: with no terms nothing changes (45 s, 0.005, same floor)', async () => {
  const { sends, deps } = chain({ provider: ONE, buyer: ONE })
  const r = await demoRun('silent', deps)
  assert.equal(r.status, 200)
  const post = sends.find((s) => s.fn === 'postOffer')!
  assert.equal(post.args[3], 45n)
  assert.equal(post.value, BOND)
  assert.equal(r.body.responseWindow, 45)
  // The legacy floor: a provider holding exactly the floor still runs.
  const exact = chain({ provider: MIN_WALLET_BALANCE_NATIVE, buyer: MIN_WALLET_BALANCE_NATIVE })
  assert.equal((await demoRun('silent', exact.deps)).status, 200)
})

test('demo run: the provider must hold the chosen bond on top of the floor', async () => {
  const bond = bondOf('0.020')
  const short = chain({ provider: MIN_WALLET_BALANCE_NATIVE + bond - 1n, buyer: ONE })
  const low = await demoRun('silent', short.deps, { windowS: 90, bond })
  assert.equal(low.status, 503)
  assert.equal(low.body.error, 'wallets_low')
  assert.equal(short.sends.length, 0, 'nothing is sent from a wallet that cannot cover the bond')
  const enough = chain({ provider: MIN_WALLET_BALANCE_NATIVE + bond, buyer: ONE })
  assert.equal((await demoRun('silent', enough.deps, { windowS: 90, bond })).status, 200)
  // The same balance is enough for the default bond.
  assert.equal((await walletFloor({ pub: short.deps.pub!, accounts: ctx().accounts })).ok, true)
})

test('an own-wallet offer is only reused when its terms match', () => {
  const open = (over = {}) => job({ status: Status.Open, requestHash: normalHash, designated: demoBuyerAddress as never, postedAt: NOW - 10, ...over })
  const defaults = open()
  const custom = open({ bond: bondOf('0.020'), responseWindow: 90 })
  assert.equal(reusableOffer(snap([defaults]), demoBuyerAddress)?.id, defaults.id, 'no terms means the defaults')
  assert.equal(reusableOffer(snap([custom]), demoBuyerAddress), undefined, 'a 90 s / 0.020 offer is not handed to a default request')
  assert.equal(reusableOffer(snap([custom]), demoBuyerAddress, { windowS: 90, bond: bondOf('0.020') })?.id, custom.id)
  assert.equal(reusableOffer(snap([custom]), demoBuyerAddress, { windowS: 30, bond: bondOf('0.020') }), undefined, 'same bond, other window')
  assert.equal(reusableOffer(snap([defaults]), demoBuyerAddress, { windowS: 45, bond: bondOf('0.010') }), undefined, 'same window, other bond')
})

async function post(handler: (req: ApiRequest, res: ApiResponse) => Promise<void>, body: unknown) {
  let status = 0
  let out = ''
  const res = { setHeader() {}, end: (b: string) => (out = b), set statusCode(v: number) { status = v } } as unknown as ApiResponse
  await handler({ method: 'POST', body } as ApiRequest, res)
  return { status, body: JSON.parse(out) as { error?: string } }
}

test('routes: a bad deadline or bond is a 400 before anything is sent', async () => {
  for (const body of [{ mode: 'silent', windowS: 60 }, { mode: 'silent', windowS: '45' }, { mode: 'silent', bond: '0.05' }, { mode: 'silent', bond: 0.005 }, { mode: 'normal', windowS: null }]) {
    const r = await post(demoRunRoute, body)
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.match(r.body.error ?? '', /must be one of/)
  }
  const buyer = '0x00000000000000000000000000000000000000aa'
  const r = await post(offerRoute, { buyer, windowS: 100 })
  assert.equal(r.status, 400)
  assert.match(r.body.error ?? '', /windowS must be one of 30, 45, 90/)
  assert.equal((await post(offerRoute, { buyer, bond: '0.001' })).status, 400)
})
