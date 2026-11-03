// Turns a Claude Code transcript (JSONL) into a readable Markdown file: every prompt and reply in full, one line
// per tool call, and no images, thinking or tool output.

import fs from 'node:fs'
import readline from 'node:readline'
import { formatDateTime } from '@shared/format'
import type { Language } from '@shared/types'

const MAX_BLOCK = 20_000

interface Block {
  type?: string
  text?: string
  name?: string
  input?: Record<string, unknown>
}

const L = {
  'zh-CN': { you: '你', claude: 'Claude', folder: '文件夹', started: '开始', last: '最后活动', id: '会话 ID', image: '（图片已省略）', cut: '（内容过长，已省略 {n} 字）', footer: '由 QuotaDeck 导出', tool: '工具' },
  en: { you: 'You', claude: 'Claude', folder: 'Folder', started: 'Started', last: 'Last activity', id: 'Session ID', image: '(image omitted)', cut: '(too long, {n} characters omitted)', footer: 'Exported by QuotaDeck', tool: 'Tool' }
} as const

/** File name from a title: characters Windows and macOS refuse are replaced, length is capped. */
export function safeFileName(title: string | undefined): string {
  const clean = (title ?? '')
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  return clean || 'conversation'
}

function clip(text: string, lang: Language): string {
  if (text.length <= MAX_BLOCK) return text
  return `${text.slice(0, MAX_BLOCK)}\n\n${L[lang].cut.replace('{n}', String(text.length - MAX_BLOCK))}`
}

/** One line describing a tool call: its name and the argument that says what it did. */
export function toolSummary(b: Block): string {
  const inp = b.input ?? {}
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = inp[k]
      if (typeof v === 'string' && v.trim()) return v.trim()
    }
    return undefined
  }
  const arg = pick('description', 'command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt', 'skill') ?? ''
  const oneLine = arg.split(/\r?\n/)[0]
  return `${b.name ?? 'tool'}${oneLine ? ` — ${oneLine.length > 140 ? `${oneLine.slice(0, 140)}…` : oneLine}` : ''}`
}

/** Text the user typed, or undefined for commands, hook notes, reminders and tool results. */
function userText(content: unknown, lang: Language): string | undefined {
  const parts: string[] = []
  if (typeof content === 'string') parts.push(content)
  else if (Array.isArray(content)) {
    for (const p of content as Block[]) {
      if (p?.type === 'text' && typeof p.text === 'string') parts.push(p.text)
      else if (p?.type === 'image') parts.push(L[lang].image)
      else if (p?.type === 'tool_result') return undefined
    }
  }
  const text = parts.join('\n\n').trim()
  if (!text || /^<(command-|local-command|system-reminder|bash-|user-memory|task-notification)/i.test(text) || /^Caveat:/i.test(text)) return undefined
  return text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim() || undefined
}

export interface ExportMeta {
  title: string
  cliSessionId: string
  cwd?: string
  createdAt?: number
  lastActivityAt?: number
  lang: Language
  timeZone?: string
}

export async function transcriptToMarkdown(file: string, meta: ExportMeta): Promise<string> {
  const t = L[meta.lang]
  const out: string[] = [`# ${meta.title}`, '']
  if (meta.cwd) out.push(`- ${t.folder}: \`${meta.cwd}\``)
  if (meta.createdAt) out.push(`- ${t.started}: ${formatDateTime(meta.createdAt, meta.timeZone, meta.lang)}`)
  if (meta.lastActivityAt) out.push(`- ${t.last}: ${formatDateTime(meta.lastActivityAt, meta.timeZone, meta.lang)}`)
  out.push(`- ${t.id}: \`${meta.cliSessionId}\``, '')

  let speaker: 'user' | 'assistant' | undefined
  const heading = (who: 'user' | 'assistant') => {
    if (speaker === who) return
    speaker = who
    out.push(`## ${who === 'user' ? t.you : t.claude}`, '')
  }

  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of rl) {
    if (!line || line[0] !== '{') continue
    let j: { type?: string; isMeta?: boolean; isSidechain?: boolean; message?: { content?: unknown } }
    try {
      j = JSON.parse(line)
    } catch {
      continue
    }
    if (j.isSidechain) continue
    if (j.type === 'user' && !j.isMeta) {
      const text = userText(j.message?.content, meta.lang)
      if (!text) continue
      heading('user')
      out.push(clip(text, meta.lang), '')
    } else if (j.type === 'assistant' && Array.isArray(j.message?.content)) {
      for (const b of j.message!.content as Block[]) {
        if (b?.type === 'text' && b.text?.trim()) {
          heading('assistant')
          out.push(clip(b.text.trim(), meta.lang), '')
        } else if (b?.type === 'tool_use') {
          heading('assistant')
          out.push(`> ${t.tool}: ${toolSummary(b)}`, '')
        }
      }
    }
  }
  out.push('---', '', `*${t.footer}*`, '')
  return out.join('\n')
}
