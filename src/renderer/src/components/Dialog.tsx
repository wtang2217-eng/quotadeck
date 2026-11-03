import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { play } from '../sound'
import { IconX } from './icons'

/**
 * Modal dialog with open/close motion and sounds. `onClose` is called after the exit animation.
 * Children receive a `close` function through the render prop so inner buttons animate out too.
 */
export function Dialog({
  title,
  kicker,
  sub,
  icon,
  wide,
  onClose,
  dismissable = true,
  children,
  footer
}: {
  title: ReactNode
  /** Mono label above the title. */
  kicker?: ReactNode
  sub?: ReactNode
  icon?: ReactNode
  wide?: boolean
  onClose: () => void
  dismissable?: boolean
  children: ReactNode | ((close: () => void) => ReactNode)
  footer?: ReactNode | ((close: () => void) => ReactNode)
}) {
  const [closing, setClosing] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  useLayoutEffect(() => {
    play('open')
  }, [])

  const close = useCallback(() => {
    if (done.current) return
    done.current = true
    play('close')
    setClosing(true)
    window.setTimeout(onClose, 170)
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) close()
    }
    window.addEventListener('keydown', onKey)
    const first = panel.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, select, button.btn-primary')
    first?.focus({ preventScroll: true })
    return () => window.removeEventListener('keydown', onKey)
  }, [close, dismissable])

  return createPortal(
    <div
      className={`backdrop${closing ? ' closing' : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissable) close()
      }}
    >
      <div className={`dialog${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" ref={panel}>
        <div className="dialog-head">
          {icon && <div className="dialog-head-icon">{icon}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            {kicker && <span className="kicker dialog-kicker">{kicker}</span>}
            <h2 className="dialog-title">{title}</h2>
            {sub && <div className="dialog-sub">{sub}</div>}
          </div>
          {dismissable && (
            <button type="button" className="icon-btn" aria-label="close" data-sound="none" onClick={close}>
              <IconX size={18} />
            </button>
          )}
        </div>
        <div className="dialog-body">{typeof children === 'function' ? children(close) : children}</div>
        {footer && <div className="dialog-foot">{typeof footer === 'function' ? footer(close) : footer}</div>}
      </div>
    </div>,
    document.body
  )
}
