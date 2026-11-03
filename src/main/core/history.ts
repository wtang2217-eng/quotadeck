// Index of Claude Code transcripts (~/.claude/projects/<project>/<sessionId>.jsonl). Transcripts can be
// tens of megabytes, so only the head and tail of each file are read, and results are cached by size
// and modification time.

import fs from 'node:fs'
import path from 'node:path'
import { readHead, readJson, readTail, writeJsonAtomic } from './jsonfile'
import { projectsDir, qdPaths, safeReaddir } from './paths'

export interface TranscriptMeta {
  file: string
  cliSessionId: string
  projectDir: string
  mtimeMs: number
  size: number
  cwd?: string
  firstPrompt?: string
  lastPrompt?: string
  /** Title set by the user or the desktop app (`custom-title`), else the automatic one (`ai-title`). */
  title?: string
  entrypoint?: string
  createdAt?: number
  lastActivityAt: number
  /** Estimated number of lines, from the average line length of the sampled parts. */
  lines: number
}

const HEAD_BYTES = 96 * 1024
const TAIL_BYTES = 512 * 1024
const CACHE_VERSION = 4

let cache: Record<string, TranscriptMeta> | undefined

function loadCache(): Record<string, TranscriptMeta> {
  if (cache) return cache
  const json = readJson<{ version: number; items: Record<string, TranscriptMeta> }>(qdPaths().historyCache)
  cache = json?.version === CACHE_VERSION ? json.items : {}
  return cache
}

export function saveHistoryCache(): void {
  if (cache) writeJsonAtomic(qdPaths().historyCache, { version: CACHE_VERSION, items: cache })
}

/** Text of a user message, or undefined when it is a command, a hook note or other non-prompt content. */
function promptText(message: unknown): string | undefined {
  const m = message as { content?: unknown } | undefined
  let text: string | undefined
  if (typeof m?.content === 'string') text = m.content
  else if (Array.isArray(m?.content)) {
    const part = (m!.content as Array<{ type?: string; text?: string }>).find((p) => p?.type === 'text' && typeof p.text === 'string')
    text = part?.text
  }
  if (!text) return undefined
  const trimmed = text.trim()
  if (!trimmed || /^<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/i.test(trimmed) || /^Caveat:/i.test(trimmed)) return undefined
  return trimmed.replace(/<[^>]+>[\s\S]*?<\/[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200) || undefined
}

function parseLines(text: string, dropFirst: boolean): Array<Record<string, unknown>> {
  const lines = text.split('\n')
  if (dropFirst) lines.shift()
  const out: Array<Record<string, unknown>> = []
  for (const line of lines) {
    if (!line || line[0] !== '{') continue
    try {
      out.push(JSON.parse(line))
    } catch {
      /* cut-off line at the edge of a sample */
    }
  }
  return out
}

/** First `"name":"value"` in raw JSONL text, decoded as a JSON string. */
function rawField(text: string, name: string): string | undefined {
  const m = new RegExp(`"${name}":("(?:[^"\\\\]|\\\\.)*")`).exec(text)
  if (!m) return undefined
  try {
    return JSON.parse(m[1]) as string
  } catch {
    return undefined
  }
}

function isoTime(v: unknown): number | undefined {
  if (typeof v !== 'string') return undefined
  const t = Date.parse(v)
  return Number.isFinite(t) ? t : undefined
}

export function readTranscriptMeta(file: string): TranscriptMeta | undefined {
  let st: fs.Stats
  try {
    st = fs.statSync(file)
  } catch {
    return undefined
  }
  const c = loadCache()
  const hit = c[file]
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit

  const head = readHead(file, HEAD_BYTES)
  const tail = st.size > HEAD_BYTES ? readTail(file, TAIL_BYTES) : ''
  const headLines = parseLines(head, false)
  const tailLines = tail ? parseLines(tail, true) : []

  const meta: TranscriptMeta = {
    file,
    cliSessionId: path.basename(file, '.jsonl'),
    projectDir: path.basename(path.dirname(file)),
    mtimeMs: st.mtimeMs,
    size: st.size,
    lastActivityAt: st.mtimeMs,
    lines: 0
  }
  let customTitle: string | undefined
  let aiTitle: string | undefined
  for (const j of headLines) {
    if (!meta.cwd && typeof j.cwd === 'string') meta.cwd = j.cwd
    if (!meta.entrypoint && typeof j.entrypoint === 'string') meta.entrypoint = j.entrypoint
    if (!meta.createdAt) meta.createdAt = isoTime(j.timestamp)
    if (!meta.firstPrompt && j.type === 'user' && !j.isMeta && !j.isSidechain) meta.firstPrompt = promptText(j.message)
    if (j.type === 'custom-title' && typeof j.customTitle === 'string') customTitle = j.customTitle
    if (j.type === 'ai-title' && typeof j.aiTitle === 'string') aiTitle = j.aiTitle
    if (j.type === 'last-prompt' && typeof j.lastPrompt === 'string') meta.lastPrompt = j.lastPrompt
  }
  let lastTs: number | undefined
  for (const j of tailLines) {
    if (j.type === 'custom-title' && typeof j.customTitle === 'string') customTitle = j.customTitle
    if (j.type === 'ai-title' && typeof j.aiTitle === 'string') aiTitle = j.aiTitle
    if (j.type === 'last-prompt' && typeof j.lastPrompt === 'string') meta.lastPrompt = j.lastPrompt
    const t = isoTime(j.timestamp)
    if (t && (!lastTs || t > lastTs)) lastTs = t
  }
  // A first message with a pasted image can be longer than the sample, so its line never parses; the fields
  // are still in the raw text.
  if (!meta.cwd) meta.cwd = rawField(head, 'cwd')
  if (!meta.entrypoint) meta.entrypoint = rawField(head, 'entrypoint')
  // Every message carries the working folder, so the tail has it when the head did not parse.
  if (!meta.cwd) meta.cwd = tailLines.map((j) => j.cwd).find((c): c is string => typeof c === 'string') ?? (tail ? rawField(tail, 'cwd') : undefined)
  meta.title = (customTitle || aiTitle)?.trim().slice(0, 200) || undefined
  if (meta.lastPrompt) meta.lastPrompt = meta.lastPrompt.replace(/\s+/g, ' ').trim().slice(0, 200)
  if (lastTs) meta.lastActivityAt = Math.max(lastTs, meta.createdAt ?? 0)
  const sampledBytes = Buffer.byteLength(head) + Buffer.byteLength(tail)
  const sampledLines = headLines.length + tailLines.length
  meta.lines = sampledLines ? Math.max(sampledLines, Math.round((st.size / sampledBytes) * sampledLines)) : 0
  c[file] = meta
  return meta
}

/** Every top-level transcript, newest first. */
export function listTranscripts(): TranscriptMeta[] {
  const root = projectsDir()
  const out: TranscriptMeta[] = []
  const live = new Set<string>()
  for (const proj of safeReaddir(root)) {
    const dir = path.join(root, proj)
    for (const name of safeReaddir(dir)) {
      if (!name.endsWith('.jsonl')) continue
      const file = path.join(dir, name)
      live.add(file)
      const meta = readTranscriptMeta(file)
      if (meta) out.push(meta)
    }
  }
  const c = loadCache()
  for (const key of Object.keys(c)) if (!live.has(key)) delete c[key]
  return out.sort((a, b) => b.lastActivityAt - a.lastActivityAt)
}

export function findTranscript(cliSessionId: string): TranscriptMeta | undefined {
  return listTranscripts().find((t) => t.cliSessionId === cliSessionId)
}
