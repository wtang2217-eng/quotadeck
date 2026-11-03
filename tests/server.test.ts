import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startServer, type RunningServer } from '../src/main/core/server'

let server: RunningServer
const calls: unknown[] = []

function post(path: string, body: unknown, headers: Record<string, string>): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request(
      { host: '127.0.0.1', port: server.port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers } },
      (res) => {
        let text = ''
        res.on('data', (c) => (text += c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, text }))
      }
    )
    req.on('error', reject)
    req.end(data)
  })
}

beforeAll(async () => {
  server = await startServer(47000 + Math.floor(Math.random() * 500), 'k', {
    statusline: (b) => `hello ${(b as { n: number }).n}`,
    stopFailure: (b, h) => calls.push({ b, account: h['x-qd-account'] }),
    sessionStart: (h) => calls.push({ ping: h['x-qd-account'] })
  })
})
afterAll(() => server.close())

describe('local server', () => {
  it('answers the status line with text', async () => {
    expect(await post('/qd/statusline', { n: 3 }, { 'X-QuotaDeck-Key': 'k' })).toEqual({ status: 200, text: 'hello 3' })
  })

  it('accepts the hook with an empty body and passes the headers through', async () => {
    const r = await post('/qd/hook/stop-failure', { error: 'rate_limit' }, { 'X-QuotaDeck-Key': 'k', 'X-QD-Account': 'abc' })
    expect(r).toEqual({ status: 200, text: '' })
    expect(calls).toEqual([{ b: { error: 'rate_limit' }, account: 'abc' }])
  })

  it('rejects calls without the key or with a foreign Host header', async () => {
    expect((await post('/qd/statusline', {}, {})).status).toBe(403)
    expect((await post('/qd/statusline', {}, { 'X-QuotaDeck-Key': 'k', Host: 'evil.example:80' })).status).toBe(403)
  })
})
