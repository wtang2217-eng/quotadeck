import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface MenuItem {
  label: ReactNode
  icon?: ReactNode
  sub?: ReactNode
  danger?: boolean
  disabled?: boolean
  onSelect: () => void
}

export type MenuEntry = MenuItem | 'sep' | { heading: ReactNode }

/** Dropdown menu anchored to its trigger. Closes on outside click, Escape or selection. */
export function Menu({
  trigger,
  items,
  up,
  label
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => ReactNode
  items: MenuEntry[]
  up?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu-anchor" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div className={`menu${up ? ' up' : ''}`} role="menu" aria-label={label}>
          {items.map((it, i) => {
            if (it === 'sep') return <div key={i} className="menu-sep" />
            if ('heading' in it)
              return (
                <div key={i} className="menu-label">
                  {it.heading}
                </div>
              )
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                className={`menu-item${it.danger ? ' danger' : ''}`}
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false)
                  it.onSelect()
                }}
              >
                {it.icon}
                <span className="ellipsis">{it.label}</span>
                {it.sub && <span className="menu-item-sub">{it.sub}</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
