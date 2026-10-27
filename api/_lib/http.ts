import type { IncomingMessage, ServerResponse } from 'node:http'

/** Structural subset of Vercel's request/response, so no extra dependency is needed. */
export interface ApiRequest extends IncomingMessage {
  query: Record<string, string | string[] | undefined>
  body?: unknown
}
export interface ApiResponse extends ServerResponse {
  status(code: number): ApiResponse
  json(body: unknown): ApiResponse
}

export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message)
  }
}

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)

export function send(res: ApiResponse, status: number, body: unknown): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body, replacer, 2))
}

/** Strips URLs and RPC tokens from an error message before it reaches a client or a response body. */
export function redact(message: string): string {
  return message.replace(/https?:\/\/\S+/g, '[url]').replace(/_rpc_token=[^&\s"']+/g, '_rpc_token=REDACTED')
}

const NOT_AN_OBJECT = 'body must be a JSON object'

export function bodyOf(req: ApiRequest): Record<string, unknown> {
  const b = req.body
  if (b === undefined || b === null || b === '') return {}
  let value: unknown = b
  if (typeof b === 'string') {
    try {
      value = JSON.parse(b)
    } catch {
      throw new HttpError(400, 'body is not valid JSON')
    }
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, NOT_AN_OBJECT)
  return value as Record<string, unknown>
}

type Handler = (req: ApiRequest) => Promise<{ status?: number; body: unknown }>

/** Wraps a route: method gate, JSON output, and errors that never leak secrets. */
export function route(methods: string[], handler: Handler) {
  return async (req: ApiRequest, res: ApiResponse): Promise<void> => {
    if (!methods.includes(req.method ?? 'GET')) {
      res.setHeader('allow', methods.join(', '))
      return send(res, 405, { error: `use ${methods.join(' or ')}` })
    }
    try {
      const out = await handler(req)
      send(res, out.status ?? 200, out.body)
    } catch (err) {
      if (err instanceof HttpError) {
        if (typeof err.extra.retryAfterSeconds === 'number') res.setHeader('retry-after', String(err.extra.retryAfterSeconds))
        return send(res, err.statusCode, { error: err.message, ...err.extra })
      }
      const e = err as { shortMessage?: string; message?: string; name?: string }
      send(res, 500, { error: redact(e.shortMessage ?? e.message ?? 'internal error'), name: e.name })
    }
  }
}

export function parseJobId(v: unknown): bigint {
  if ((typeof v === 'string' && /^\d{1,18}$/.test(v)) || (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0)) {
    const id = BigInt(v)
    if (id > 0n) return id
  }
  throw new HttpError(400, 'jobId must be a positive integer')
}

/**
 * True only when a cron secret is configured and the request carries exactly `Bearer <secret>` (Vercel Cron sends
 * that header whenever CRON_SECRET exists). A user-agent check would not do: anyone can send one.
 */
export function isCronRequest(authorization: string | string[] | undefined, secret: string | undefined = process.env.CRON_SECRET): boolean {
  if (!secret || typeof authorization !== 'string') return false
  const want = `Bearer ${secret}`
  // Compare every character even after a mismatch, so timing does not reveal how much of the secret was right.
  let diff = authorization.length ^ want.length
  for (let i = 0; i < want.length; i++) diff |= (authorization.charCodeAt(i) || 0) ^ want.charCodeAt(i)
  return diff === 0
}
