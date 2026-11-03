// Where the tray popover goes: next to the tray icon, on the side away from the taskbar or menu bar,
// and always inside the screen's work area. Pure geometry so it can be tested without Electron.

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export interface PlacementInput {
  /** tray.getBounds(); all zeros when the platform cannot tell (Linux, or an icon hidden in the overflow area). */
  tray: Rect
  /** Bounds and work area of the display the icon is on. */
  display: Rect
  workArea: Rect
  size: Size
  /** Fallback anchor when the tray bounds are unknown. */
  cursor?: { x: number; y: number }
  /** Space between the popover and the taskbar, menu bar or screen edge. */
  gap: number
}

export type Edge = 'top' | 'bottom' | 'left' | 'right'

const right = (r: Rect) => r.x + r.width
const bottom = (r: Rect) => r.y + r.height
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Which screen edge the taskbar or menu bar holding the icon sits on. */
export function trayEdge(anchor: { x: number; y: number }, display: Rect, workArea: Rect): Edge {
  if (anchor.x < workArea.x) return 'left'
  if (anchor.x >= right(workArea)) return 'right'
  if (anchor.y < workArea.y) return 'top'
  if (anchor.y >= bottom(workArea)) return 'bottom'
  // Auto-hidden taskbar (the work area is the whole screen): use the half of the screen the icon is in.
  const dx = Math.min(anchor.x - display.x, right(display) - anchor.x)
  const dy = Math.min(anchor.y - display.y, bottom(display) - anchor.y)
  if (dx < dy) return anchor.x - display.x < right(display) - anchor.x ? 'left' : 'right'
  return anchor.y - display.y < bottom(display) - anchor.y ? 'top' : 'bottom'
}

export function popoverPosition(input: PlacementInput): { x: number; y: number } {
  const { tray, display, workArea, size, gap } = input
  const known = tray.width > 0 && tray.height > 0
  const anchorRect: Rect = known
    ? tray
    : { x: input.cursor?.x ?? right(workArea) - gap, y: input.cursor?.y ?? bottom(workArea) - gap, width: 0, height: 0 }
  const cx = anchorRect.x + anchorRect.width / 2
  const cy = anchorRect.y + anchorRect.height / 2
  const edge = trayEdge({ x: cx, y: cy }, display, workArea)

  let x: number
  let y: number
  switch (edge) {
    case 'top':
      x = cx - size.width / 2
      y = Math.max(bottom(anchorRect), workArea.y) + gap
      break
    case 'bottom':
      x = cx - size.width / 2
      y = Math.min(anchorRect.y, bottom(workArea)) - size.height - gap
      break
    case 'left':
      x = Math.max(right(anchorRect), workArea.x) + gap
      y = cy - size.height / 2
      break
    case 'right':
      x = Math.min(anchorRect.x, right(workArea)) - size.width - gap
      y = cy - size.height / 2
      break
  }
  return {
    x: Math.round(clamp(x, workArea.x + gap, right(workArea) - size.width - gap)),
    y: Math.round(clamp(y, workArea.y + gap, bottom(workArea) - size.height - gap))
  }
}
