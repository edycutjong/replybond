import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { encodeEventTopics, pad, toHex } from 'viem'
import type { Address } from 'viem'
import { replyBondAbi } from '../src/lib/abi'
import { SYSTEM_EMITTER, classifyReceipt } from '../src/lib/classifyReceipt'
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
