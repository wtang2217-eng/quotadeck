// A tiny HTTP server on 127.0.0.1 that receives Claude Code's StopFailure hook and status line calls.
// It refuses anything that is not from this computer, not addressed to 127.0.0.1/localhost, or missing the key.

import http from 'node:http'

export interface ServerHandlers {
  statusline(body: unknown): string
  stopFailure(body: unknown, headers: http.IncomingHttpHeaders): void
  sessionStart(headers: http.IncomingHttpHeaders): void
}

export interface RunningServer {
  port: number
  close(): Promise<void>
}

const MAX_BODY = 2 * 1024 * 1024

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function isLoopback(addr: string | undefined): boolean {
  return !!addr && (addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1')
}

export function startServer(port: number, key: string, handlers: ServerHandlers, tries = 10): Promise<RunningServer> {
  const server = http.createServer(async (req, res) => {
    const host = String(req.headers.host ?? '')
    const actualPort = (server.address() as { port: number } | null)?.port
    const hostOk = host === `127.0.0.1:${actualPort}` || host === `localhost:${actualPort}`
    if (!isLoopback(req.socket.remoteAddress) || !hostOk || req.headers['x-quotadeck-key'] !== key) {
      res.writeHead(403).end()
      return
    }
    try {
      if (req.method === 'GET' && req.url === '/qd/health') {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
        return
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end()
        return
      }
      const raw = await readBody(req)
      let body: unknown = {}
      try {
        body = raw ? JSON.parse(raw) : {}
      } catch {
        res.writeHead(400).end()
        return
      }
      if (req.url === '/qd/statusline') {
        const text = handlers.statusline(body)
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end(text)
      } else if (req.url === '/qd/hook/stop-failure') {
        handlers.stopFailure(body, req.headers)
        // An empty 2xx body is "success, no output" for Claude Code.
        res.writeHead(200).end()
      } else if (req.url === '/qd/hook/session-start') {
        handlers.sessionStart(req.headers)
        res.writeHead(200).end()
      } else {
        res.writeHead(404).end()
      }
    } catch {
      if (!res.headersSent) res.writeHead(500).end()
    }
  })

  return new Promise((resolve, reject) => {
    let attempt = 0
    const tryListen = (p: number) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && attempt < tries) {
          attempt++
          tryListen(p + 1)
        } else reject(err)
      })
      server.listen(p, '127.0.0.1', () => {
        server.removeAllListeners('error')
        resolve({
          port: (server.address() as { port: number }).port,
          close: () => new Promise((r) => server.close(() => r()))
        })
      })
    }
    tryListen(port)
  })
}
