// Small building blocks shared by pages and dialogs.

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { AccountStatus, PlanInfo } from '@shared/types'
import { play } from '../sound'
import type { T } from '../i18n'
import { initial, planText, prefersReducedMotion, statusKey, statusTone } from '../util'

export function Toggle({
  on,
  onChange,
  disabled,
  label
}: {
  on: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className={`toggle${on ? ' on' : ''}`}
      disabled={disabled}
      data-sound="none"
      onClick={() => {
        play(on ? 'toggleOff' : 'toggleOn')
        onChange(!on)
      }}
    />
  )
}

/** Segmented control with a gliding pill under the active option. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: V
  options: { value: V; label: ReactNode }[]
  onChange: (v: V, e: MouseEvent<HTMLButtonElement>) => void
  ariaLabel: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const el = wrap.current?.querySelector<HTMLButtonElement>('button.on')
    if (el) setPill({ x: el.offsetLeft, w: el.offsetWidth })
  }, [value, options.length])
  return (
    <div className="segmented" role="radiogroup" aria-label={ariaLabel} ref={wrap}>
      {pill && <span className="segmented-pill" style={{ width: pill.w, transform: `translateX(${pill.x}px)` }} />}
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={(e) => o.value !== value && onChange(o.value, e)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Check({
  checked,
  onChange,
  children,
  hint,
  disabled
}: {
  checked: boolean
  onChange: (v: boolean) => void
  children: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => {
          play(e.target.checked ? 'toggleOn' : 'toggleOff')
          onChange(e.target.checked)
        }}
      />
      <span className="check-text">
        {children}
        {hint && <span className="check-hint">{hint}</span>}
      </span>
    </label>
  )
}

export function PlanBadge({ plan, t }: { plan?: PlanInfo; t: T }) {
  return <span className={`badge badge-plan ${plan?.kind ?? 'unknown'}`}>{planText(plan, t)}</span>
}

export function StatusChip({ status, t }: { status: AccountStatus; t: T }) {
  const tone = statusTone(status)
  return (
    <span className={`chip chip-${tone}`}>
      <span className="dot" />
      {t(statusKey(status))}
    </span>
  )
}

export function Avatar({
  account,
  size = 40,
  live
}: {
  account: { nickname?: string; email?: string; displayName?: string; id: string; color: string }
  size?: number
  live?: boolean
}) {
  const ch = initial(account)
  const radius = Math.round(size * 0.3)
  return (
    <span
      className="avatar"
      title={account.nickname || account.email}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.42),
        background: `linear-gradient(140deg, color-mix(in srgb, ${account.color} 78%, white), ${account.color} 60%, color-mix(in srgb, ${account.color} 80%, black))`
      }}
    >
      {ch}
      {live && <span className="avatar-live" />}
    </span>
  )
}

/** Counts up to the value on mount and eases between later values. */
export function AnimatedNumber({ value, duration = 700 }: { value: number; duration?: number }) {
  const [shown, setShown] = useState(() => (prefersReducedMotion() ? value : 0))
  const from = useRef(shown)
  useEffect(() => {
    if (prefersReducedMotion()) {
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      const v = a + (value - a) * eased
      setShown(v)
      from.current = v
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  return <>{Math.round(shown)}</>
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />
}

export function Empty({ icon, title, hint, children }: { icon: ReactNode; title: string; hint?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint && <div className="empty-hint">{hint}</div>}
      {children && <div style={{ marginTop: 16 }}>{children}</div>}
    </div>
  )
}

/** A button that asks for a second click before running a destructive action. */
export function ConfirmButton({
  children,
  confirmLabel,
  onConfirm,
  className = 'btn btn-sm btn-ghost btn-danger'
}: {
  children: ReactNode
  confirmLabel: string
  onConfirm: () => void
  className?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = setTimeout(() => setArmed(false), 3500)
    return () => clearTimeout(id)
  }, [armed])
  return (
    <button
      type="button"
      className={className + (armed ? ' btn-danger-solid' : '')}
      onClick={() => {
        if (armed) {
          setArmed(false)
          onConfirm()
        } else setArmed(true)
      }}
    >
      {armed ? confirmLabel : children}
    </button>
  )
}
