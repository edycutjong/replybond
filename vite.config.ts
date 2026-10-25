import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import fs from 'fs'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

/**
 * Preview support for Vercel-style serverless functions: serves api/<name>.ts at /api/<name>
 * using the same default-export (req, res) handlers Vercel runs. Unknown paths fall through
 * (to the /api proxy below).
 */
function vercelApi(): Plugin {
  return {
    name: 'vercel-api-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        const m = /^\/api\/([a-z0-9-]+)\/?$/i.exec(url.pathname)
        if (!m || !fs.existsSync(path.resolve(__dirname, 'api', `${m[1]}.ts`))) return next()
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const raw = Buffer.concat(chunks).toString('utf8')
        let body: unknown = raw
        if (raw && (req.headers['content-type'] ?? '').includes('json')) {
          try {
            body = JSON.parse(raw)
          } catch {
            body = raw
          }
        }
        const r = res as typeof res & { status: (c: number) => typeof res; json: (b: unknown) => typeof res }
        r.status = (code) => {
          res.statusCode = code
          return res
        }
        r.json = (b) => {
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify(b))
          return res
        }
        Object.assign(req, { query: Object.fromEntries(url.searchParams), body })
        try {
          const mod = await server.ssrLoadModule(`/api/${m[1]}.ts`)
          await (mod.default as (a: unknown, b: unknown) => Promise<void>)(req, res)
        } catch (err) {
          server.ssrFixStacktrace(err as Error)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Expose .env to the api/ handlers (Vite only exposes VITE_* to the browser).
  for (const [k, v] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (process.env[k] === undefined) process.env[k] = v
  }
  return {
  plugins: [react(), nodePolyfills(), vercelApi()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react/jsx-runtime',
      '@tanstack/react-query',
      'wagmi',
      'wagmi/chains',
      'wagmi/connectors',
      'viem',
      'viem/chains',
      'connectkit',
      'framer-motion',
      'lucide-react',
      'sonner',
      'clsx',
      'tailwind-merge',
      'vite-plugin-node-polyfills/shims/buffer',
      'vite-plugin-node-polyfills/shims/global',
      'vite-plugin-node-polyfills/shims/process',
    ],
  },
  server: {
    allowedHosts: true,
    cors: true,
    proxy: {
      '^/api/(?!_lib/)': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ''),
      },
    },
  },
}
})
