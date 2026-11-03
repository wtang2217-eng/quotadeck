import fs from 'node:fs'
import path from 'node:path'

export function readJson<T = unknown>(file: string): T | undefined {
  try {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '')
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

/** Write through a temp file and rename, for QuotaDeck's own files. */
export function writeJsonAtomic(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

/**
 * Overwrite a file in place (same inode). Used for Claude Code's settings.json, which profile folders
 * may share through a hard link that a rename would break.
 */
export function writeTextInPlace(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text, 'utf8')
}

/** Read the first `bytes` of a file as UTF-8. */
export function readHead(file: string, bytes: number): string {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(bytes)
    const n = fs.readSync(fd, buf, 0, bytes, 0)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Read the last `bytes` of a file as UTF-8. */
export function readTail(file: string, bytes: number): string {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const size = fs.fstatSync(fd).size
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    const n = fs.readSync(fd, buf, 0, buf.length, start)
    return buf.subarray(0, n).toString('utf8')
  } catch {
    return ''
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
