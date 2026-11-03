// Short UI sounds. The WAV files are inlined as data URLs so they also load from file:// in the packaged app,
// decoded once into AudioBuffers and played through one GainNode. Nothing here ever throws.

import alert from './assets/sounds/alert.wav?inline'
import click from './assets/sounds/click.wav?inline'
import close from './assets/sounds/close.wav?inline'
import copy from './assets/sounds/copy.wav?inline'
import error from './assets/sounds/error.wav?inline'
import open from './assets/sounds/open.wav?inline'
import success from './assets/sounds/success.wav?inline'
import switchSound from './assets/sounds/switch.wav?inline'
import toggleOff from './assets/sounds/toggleOff.wav?inline'
import toggleOn from './assets/sounds/toggleOn.wav?inline'
import warn from './assets/sounds/warn.wav?inline'

export type SoundName =
  | 'click'
  | 'toggleOn'
  | 'toggleOff'
  | 'open'
  | 'close'
  | 'success'
  | 'switch'
  | 'warn'
  | 'alert'
  | 'error'
  | 'copy'

const SOURCES: Record<SoundName, string> = {
  click,
  toggleOn,
  toggleOff,
  open,
  close,
  success,
  switch: switchSound,
  warn,
  alert,
  error,
  copy
}

export const SOUND_NAMES = Object.keys(SOURCES) as SoundName[]

const THROTTLE_MS = 40

let enabled = true
let volume = 0.5
let ctx: AudioContext | null = null
let gain: GainNode | null = null
let unavailable = false
const buffers = new Map<SoundName, AudioBuffer>()
const pending = new Map<SoundName, Promise<AudioBuffer | null>>()
const lastPlayed = new Map<SoundName, number>()
let lastSpecificAt = 0

export function configureSound(opts: { enabled: boolean; volume: number }): void {
  enabled = opts.enabled
  volume = Number.isFinite(opts.volume) ? Math.min(1, Math.max(0, opts.volume)) : 0.5
  if (gain) gain.gain.value = volume
}

function audio(): AudioContext | null {
  if (ctx || unavailable) return ctx
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      unavailable = true
      return null
    }
    ctx = new Ctor()
    gain = ctx.createGain()
    gain.gain.value = volume
    gain.connect(ctx.destination)
  } catch {
    unavailable = true
    ctx = null
  }
  return ctx
}

function toArrayBuffer(dataUrl: string): ArrayBuffer {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

function load(name: SoundName): Promise<AudioBuffer | null> {
  const cached = buffers.get(name)
  if (cached) return Promise.resolve(cached)
  const inflight = pending.get(name)
  if (inflight) return inflight
  const c = audio()
  if (!c) return Promise.resolve(null)
  let p: Promise<AudioBuffer | null>
  try {
    p = c
      .decodeAudioData(toArrayBuffer(SOURCES[name]))
      .then((b) => {
        buffers.set(name, b)
        return b
      })
      .catch(() => null)
  } catch {
    p = Promise.resolve(null)
  }
  pending.set(name, p)
  return p
}

/** Decode every sound ahead of time so the first click is not late. */
export function preloadSounds(): void {
  for (const name of SOUND_NAMES) void load(name)
}

/** Play a sound if sounds are on. `force` plays even when off (unused by default). */
export function play(name: SoundName, opts?: { force?: boolean }): void {
  if (!enabled && !opts?.force) return
  try {
    const now = performance.now()
    if (now - (lastPlayed.get(name) ?? 0) < THROTTLE_MS) return
    lastPlayed.set(name, now)
    if (name !== 'click') lastSpecificAt = now
    const c = audio()
    if (!c || !gain) return
    if (c.state === 'suspended') void c.resume().catch(() => undefined)
    const start = (buf: AudioBuffer) => {
      try {
        const src = c.createBufferSource()
        src.buffer = buf
        src.connect(gain!)
        src.start()
      } catch {
        /* audio blocked */
      }
    }
    const ready = buffers.get(name)
    if (ready) start(ready)
    else void load(name).then((buf) => buf && start(buf))
  } catch {
    /* audio blocked */
  }
}

/**
 * One delegated listener gives every button, link and nav item a click sound.
 * Elements opt out with data-sound="none" or pick another sound with data-sound="<name>".
 * A click is skipped when a more specific sound (toggle, dialog open, copy…) just played for the same gesture.
 */
export function installClickSounds(): () => void {
  const onClick = (e: MouseEvent) => {
    const el = (e.target as Element | null)?.closest?.('button, a, [role="button"], summary, select') as HTMLElement | null
    if (!el) return
    if ((el as HTMLButtonElement).disabled) return
    const wanted = el.dataset.sound
    if (wanted === 'none') return
    if (performance.now() - lastSpecificAt < 80) return
    play(wanted && wanted in SOURCES ? (wanted as SoundName) : 'click')
  }
  const unlock = () => {
    const c = audio()
    if (c && c.state === 'suspended') void c.resume().catch(() => undefined)
  }
  document.addEventListener('click', onClick)
  document.addEventListener('pointerdown', unlock, { passive: true })
  return () => {
    document.removeEventListener('click', onClick)
    document.removeEventListener('pointerdown', unlock)
  }
}
