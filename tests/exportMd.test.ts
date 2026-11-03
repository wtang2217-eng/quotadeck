import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { safeFileName, toolSummary, transcriptToMarkdown } from '../src/main/core/exportMd'

describe('safeFileName', () => {
  it('keeps Chinese titles and replaces characters file systems refuse', () => {
    expect(safeFileName('重构支付回调：补齐测试 / v2?')).toBe('重构支付回调：补齐测试 _ v2_')
    expect(safeFileName('  ..  ')).toBe('conversation')
    expect(safeFileName('x'.repeat(200))).toHaveLength(80)
  })
})

describe('toolSummary', () => {
  it('names the tool and what it acted on, on one line', () => {
    expect(toolSummary({ name: 'Bash', input: { command: 'npm test\nnpm run build' } })).toBe('Bash — npm test')
    expect(toolSummary({ name: 'Read', input: { file_path: 'src/a.ts' } })).toBe('Read — src/a.ts')
    expect(toolSummary({ name: 'TodoWrite', input: { todos: [] } })).toBe('TodoWrite')
  })
})

describe('transcriptToMarkdown', () => {
  let dir: string | undefined
  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true })
    dir = undefined
  })

  it('writes prompts and replies in full, tools as one line, and skips the rest', async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qd-md-'))
    const file = path.join(dir, 's.jsonl')
    const lines = [
      { type: 'user', message: { role: 'user', content: '<command-name>/clear</command-name>' } },
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: '把订单导出改成异步任务' }, { type: 'image', source: {} }] } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'thinking', thinking: 'secret' }] } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '好的，先看一下现在的实现。' }] } },
      { type: 'assistant', message: { id: 'm1', content: [{ type: 'tool_use', name: 'Grep', input: { pattern: 'exportOrders' } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'lots of output' }] } },
      { type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } },
      { type: 'assistant', isSidechain: true, message: { id: 'm9', content: [{ type: 'text', text: 'subagent text' }] } },
      { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: '改好了。' }] } }
    ]
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\nnot json\n')
    const md = await transcriptToMarkdown(file, { title: '订单导出', cliSessionId: 'abc', cwd: 'D:\\shop', lang: 'zh-CN' })
    expect(md).toContain('# 订单导出')
    expect(md).toContain('- 文件夹: `D:\\shop`')
    expect(md).toContain('## 你\n\n把订单导出改成异步任务\n\n（图片已省略）')
    expect(md).toContain('## Claude\n\n好的，先看一下现在的实现。\n\n> 工具: Grep — exportOrders\n\n改好了。')
    for (const hidden of ['/clear', 'secret', 'lots of output', 'meta', 'subagent text']) expect(md).not.toContain(hidden)
    // One heading per turn, not per line.
    expect(md.match(/## Claude/g)).toHaveLength(1)
  })
})
