import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import './api-env'
import { HttpError, bodyOf, isCronRequest, redact, route } from '../api/_lib/http'
import type { ApiRequest, ApiResponse } from '../api/_lib/http'

const req = (body: unknown) => ({ body }) as unknown as ApiRequest

test('bodyOf: empty bodies are {}', () => {
  assert.deepEqual(bodyOf(req(undefined)), {})
  assert.deepEqual(bodyOf(req('')), {})
  assert.deepEqual(bodyOf(req(null)), {})
})

test('bodyOf: only a JSON object passes', () => {
  assert.deepEqual(bodyOf(req('{"jobId":1}')), { jobId: 1 })
  assert.deepEqual(bodyOf(req({ jobId: 1 })), { jobId: 1 })
  for (const bad of ['null', '[]', [], '3', 3, '"x"']) {
    assert.throws(() => bodyOf(req(bad)), (e) => e instanceof HttpError && e.statusCode === 400 && e.message === 'body must be a JSON object', String(bad))
  }
  assert.throws(() => bodyOf(req('{nope')), (e) => e instanceof HttpError && e.statusCode === 400 && e.message === 'body is not valid JSON')
})

test('redact: URLs and RPC tokens never reach a client', () => {
  assert.equal(redact('HTTP request failed. URL: https://x.example/rpc?_rpc_token=abc'), 'HTTP request failed. URL: [url]')
  assert.equal(redact('bad _rpc_token=abc123&x=1 here'), 'bad _rpc_token=REDACTED&x=1 here')
  assert.equal(redact('plain message'), 'plain message')
})

test('route: a 500 body is redacted, an HttpError message is kept', async () => {
  const run = async (err: Error) => {
    let status = 0
    let body = ''
    const res = { setHeader() {}, end: (b: string) => (body = b), set statusCode(v: number) { status = v } } as unknown as ApiResponse
    await route(['GET'], async () => { throw err })({ method: 'GET' } as ApiRequest, res)
    return { status, body: JSON.parse(body) as { error: string } }
  }
  const leaked = await run(new Error('HTTP request failed. URL: https://rpc.example/x?_rpc_token=secret'))
  assert.equal(leaked.status, 500)
  assert.equal(leaked.body.error.includes('secret'), false)
  assert.equal(leaked.body.error.includes('https://'), false)
  const kept = await run(new HttpError(400, 'see https://docs.example/page'))
  assert.equal(kept.status, 400)
  assert.equal(kept.body.error, 'see https://docs.example/page')
})

test('isCronRequest: needs the secret and the exact bearer header', () => {
  assert.equal(isCronRequest('Bearer s3cret', 's3cret'), true)
  assert.equal(isCronRequest('Bearer wrong!', 's3cret'), false)
  assert.equal(isCronRequest('Bearer s3cret ', 's3cret'), false)
  assert.equal(isCronRequest(undefined, 's3cret'), false)
  assert.equal(isCronRequest(['Bearer s3cret'], 's3cret'), false)
  assert.equal(isCronRequest('Bearer undefined', undefined), false, 'no secret configured: never a cron call')
  assert.equal(isCronRequest('Bearer ', ''), false)
})
