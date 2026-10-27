import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { encodeEventTopics, pad, toHex } from 'viem'
import type { Address } from 'viem'
import { replyBondAbi } from '../src/lib/abi'
import { SYSTEM_EMITTER, classifyReceipt } from '../src/lib/classifyReceipt'
import { acknowledge41, claim25, timeout23 } from './fixtures/receipts'
import type { ReceiptLike } from '../src/lib/classifyReceipt'

const CONTRACT: Address = '0x1234fb0fb613d284d98bbe2ff89045aae5d22458'
const BUYER: Address = '0xe1bdab15addd605347ceaca5268ee157bd41e593'
const PROVIDER: Address = '0x10427423b93ea42c9bed43d8f1374033c06572a1'
const AMOUNT = 15_000_000_000_000_000n // 0.015 USDC, native 18-decimal view
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
const topicsOf = (a: Parameters<typeof encodeEventTopics>[0]) => encodeEventTopics(a) as string[]
const word = (n: bigint) => pad(toHex(n), { size: 32 })
const addrTopic = (a: Address) => pad(a, { size: 32 })

const timedOut = {
  address: CONTRACT,
  topics: topicsOf({ abi: replyBondAbi, eventName: 'JobTimedOut', args: { id: 5n, buyer: BUYER, caller: BUYER } }),
  data: word(AMOUNT),
}
const transfer = (to: Address, value = AMOUNT, emitter: string = SYSTEM_EMITTER) => ({
  address: emitter,
  topics: [TRANSFER, addrTopic(CONTRACT), addrTopic(to)],
  data: word(value),
})
const ok = (...logs: ReceiptLike['logs'][number][]): ReceiptLike => ({ status: 'success', logs })

test('PAID: settle event plus the system-emitter Transfer to the payee (real job 5 shape)', () => {
  const c = classifyReceipt(ok(timedOut, transfer(BUYER)), CONTRACT)
  assert.equal(c.kind, 'PAID')
  assert.equal(c.event, 'JobTimedOut')
  assert.equal(c.amount, AMOUNT)
  assert.equal(c.payee?.toLowerCase(), BUYER)
})

test('PAID for a claim pays the provider', () => {
  const claimed = {
    address: CONTRACT,
    topics: topicsOf({ abi: replyBondAbi, eventName: 'JobClaimed', args: { id: 3n, provider: PROVIDER, caller: BUYER } }),
    data: word(AMOUNT),
  }
  const c = classifyReceipt(ok(claimed, transfer(PROVIDER)), CONTRACT)
  assert.deepEqual([c.kind, c.event], ['PAID', 'JobClaimed'])
})

test('OWED: PayoutOwed in a successful receipt, never PAID', () => {
  const owed = {
    address: CONTRACT,
    topics: topicsOf({ abi: replyBondAbi, eventName: 'PayoutOwed', args: { id: 5n, payee: BUYER } }),
    data: word(AMOUNT),
  }
  const c = classifyReceipt(ok(owed, timedOut), CONTRACT)
  assert.equal(c.kind, 'OWED')
  assert.equal(c.amount, AMOUNT)
})

test('UNREADABLE: no receipt, failed receipt, no Transfer, wrong payee, wrong amount, spoofed emitter, no settle event', () => {
  assert.equal(classifyReceipt(null, CONTRACT).kind, 'UNREADABLE')
  assert.equal(classifyReceipt({ status: 'reverted', logs: [timedOut, transfer(BUYER)] }, CONTRACT).kind, 'UNREADABLE')
  assert.equal(classifyReceipt(ok(timedOut), CONTRACT).kind, 'UNREADABLE')
  assert.equal(classifyReceipt(ok(timedOut, transfer(PROVIDER)), CONTRACT).kind, 'UNREADABLE')
  assert.equal(classifyReceipt(ok(timedOut, transfer(BUYER, AMOUNT - 1n)), CONTRACT).kind, 'UNREADABLE')
  assert.equal(classifyReceipt(ok(timedOut, transfer(BUYER, AMOUNT, PROVIDER)), CONTRACT).kind, 'UNREADABLE')
  assert.equal(classifyReceipt(ok(transfer(BUYER)), CONTRACT).kind, 'UNREADABLE')
})

// --- Real receipts (Arc Testnet) -------------------------------------------------------------------------
const PROVIDER_HOSTED: Address = '0xacf379d9c76d58637690447ffdeb683c2ad72d5a'
const BUYER_HOSTED: Address = '0x453c79161dc015553000a9a7628bf1e5c62f37c1'

test('real acknowledge receipt (job 41, JobPaid): PAID to the provider, price + bond', () => {
  const c = classifyReceipt(acknowledge41, CONTRACT)
  assert.equal(c.kind, 'PAID')
  assert.equal(c.event, 'JobPaid')
  assert.equal(c.jobId, 41n)
  assert.equal(c.payee?.toLowerCase(), PROVIDER_HOSTED)
  assert.equal(c.amount, AMOUNT)
})

test('real claim receipt (job 25, JobClaimed): PAID to the provider', () => {
  const c = classifyReceipt(claim25, CONTRACT)
  assert.deepEqual([c.kind, c.event, c.payee?.toLowerCase(), c.amount], ['PAID', 'JobClaimed', PROVIDER_HOSTED, AMOUNT])
})

test('real timeout receipt (job 23, JobTimedOut): PAID to the buyer', () => {
  const c = classifyReceipt(timeout23, CONTRACT)
  assert.deepEqual([c.kind, c.event, c.payee?.toLowerCase(), c.amount], ['PAID', 'JobTimedOut', BUYER_HOSTED, AMOUNT])
})

test('the same real receipts still classify when the contract is given in checksum case and the RPC upper-cases hex', () => {
  const checksummed = '0x1234fB0fb613D284d98bBE2fF89045AaE5d22458' as Address
  for (const r of [acknowledge41, claim25, timeout23]) {
    const upper: ReceiptLike = {
      status: r.status,
      logs: r.logs.map((l) => ({ address: l.address.toUpperCase().replace('0X', '0x'), topics: l.topics.map((x) => x.toUpperCase().replace('0X', '0x')), data: l.data })),
    }
    assert.equal(classifyReceipt(r, checksummed).kind, 'PAID')
    assert.equal(classifyReceipt(upper, checksummed).kind, 'PAID')
  }
})

test('real receipts are not PAID when the Transfer goes to the wrong party or for the wrong amount', () => {
  // acknowledge pays the provider; if the Transfer had gone to the buyer instead, the receipt must not read as PAID
  const wrongPayee: ReceiptLike = {
    status: 'success',
    logs: [acknowledge41.logs[0]!, { ...acknowledge41.logs[1]!, topics: [acknowledge41.logs[1]!.topics[0]!, acknowledge41.logs[1]!.topics[1]!, addrTopic(BUYER_HOSTED)] }],
  }
  assert.equal(classifyReceipt(wrongPayee, CONTRACT).kind, 'UNREADABLE')
  const shortAmount: ReceiptLike = { status: 'success', logs: [acknowledge41.logs[0]!, { ...acknowledge41.logs[1]!, data: word(AMOUNT - 1n) }] }
  assert.equal(classifyReceipt(shortAmount, CONTRACT).kind, 'UNREADABLE')
})

// One receipt, several jobs: with an expected id only that job's events count.
const claimedEvent = (id: bigint) => ({
  address: CONTRACT,
  topics: topicsOf({ abi: replyBondAbi, eventName: 'JobClaimed', args: { id, provider: PROVIDER, caller: BUYER } }),
  data: word(AMOUNT),
})
const timedOutEvent = (id: bigint) => ({
  address: CONTRACT,
  topics: topicsOf({ abi: replyBondAbi, eventName: 'JobTimedOut', args: { id, buyer: BUYER, caller: BUYER } }),
  data: word(AMOUNT),
})
const owedEvent = (id: bigint, payee: Address) => ({
  address: CONTRACT,
  topics: topicsOf({ abi: replyBondAbi, eventName: 'PayoutOwed', args: { id, payee } }),
  data: word(AMOUNT),
})

test('two settlements in one receipt: each job is classified by its own events', () => {
  const both = ok(timedOutEvent(5n), transfer(BUYER), claimedEvent(6n), transfer(PROVIDER))
  const five = classifyReceipt(both, CONTRACT, 5n)
  assert.deepEqual([five.kind, five.event, five.jobId, five.payee?.toLowerCase()], ['PAID', 'JobTimedOut', 5n, BUYER])
  const six = classifyReceipt(both, CONTRACT, 6n)
  assert.deepEqual([six.kind, six.event, six.jobId, six.payee?.toLowerCase()], ['PAID', 'JobClaimed', 6n, PROVIDER])
  // without an id the last settle event wins, as before
  assert.equal(classifyReceipt(both, CONTRACT).jobId, 6n)
  // a job whose own payout has no Transfer is not rescued by the other job's Transfer
  const half = ok(timedOutEvent(5n), claimedEvent(6n), transfer(PROVIDER))
  assert.equal(classifyReceipt(half, CONTRACT, 5n).kind, 'UNREADABLE')
  assert.equal(classifyReceipt(half, CONTRACT, 6n).kind, 'PAID')
  assert.equal(classifyReceipt(both, CONTRACT, 7n).kind, 'UNREADABLE', 'an id the receipt does not settle')
})

test('a PayoutOwed for another job next to a paid one does not make the paid one OWED', () => {
  const mixed = ok(owedEvent(9n, PROVIDER), timedOutEvent(5n), transfer(BUYER))
  assert.equal(classifyReceipt(mixed, CONTRACT, 5n).kind, 'PAID')
  const owed = classifyReceipt(mixed, CONTRACT, 9n)
  assert.deepEqual([owed.kind, owed.jobId], ['OWED', 9n])
  assert.equal(classifyReceipt(mixed, CONTRACT).kind, 'OWED', 'unbound: any PayoutOwed still means OWED')
})
