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

export function bodyOf(req: ApiRequest): Record<string, unknown> {
  const b = req.body
  if (typeof b === 'string') {
    try {
      return JSON.parse(b) as Record<string, unknown>
    } catch {
      throw new HttpError(400, 'body is not valid JSON')
    }
  }
  return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
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
      if (err instanceof HttpError) return send(res, err.statusCode, { error: err.message, ...err.extra })
      const e = err as { shortMessage?: string; message?: string; name?: string }
      send(res, 500, { error: e.shortMessage ?? e.message ?? 'internal error', name: e.name })
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
