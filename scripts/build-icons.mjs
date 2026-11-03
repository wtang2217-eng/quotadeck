// Renders resources/icon.svg into the app icon (PNG + ICO), the tray icons, the macOS menu bar icon
// and the background of the macOS disk image.
//   npm run icons

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const res = (...p) => path.join(root, 'resources', ...p)
const svg = fs.readFileSync(res('icon.svg'), 'utf8')

const png = (source, size) =>
  new Resvg(source, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render().asPng()

fs.writeFileSync(res('icon.png'), png(svg, 1024))
const icoSizes = [16, 24, 32, 48, 64, 128, 256]
fs.writeFileSync(res('icon.ico'), await pngToIco(icoSizes.map((s) => png(svg, s))))

// Tray: a simplified eclipse that stays readable at 16 px; the crescent's color shows the active account's state.
fs.mkdirSync(res('tray'), { recursive: true })
const traySvg = fs.readFileSync(res('tray.svg'), 'utf8')
for (const [name, color] of [
  ['idle', '#C4B5FD'],
  ['ok', '#34D399'],
  ['warn', '#FBBF24'],
  ['limited', '#F87171']
]) {
  const source = traySvg.replaceAll('CRESCENT', color)
  fs.writeFileSync(res('tray', `tray-${name}.png`), png(source, 16))
  fs.writeFileSync(res('tray', `tray-${name}@2x.png`), png(source, 32))
}
// macOS menu bar: one monochrome template image (the "Template" suffix tells macOS to color it).
const macTray = fs.readFileSync(res('tray-mac.svg'), 'utf8')
fs.writeFileSync(res('tray', 'trayTemplate.png'), png(macTray, 18))
fs.writeFileSync(res('tray', 'trayTemplate@2x.png'), png(macTray, 36))

// Disk image window (540 x 380): the app on the left, the Applications link on the right (see electron-builder.yml).
const dmg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 380">
  <defs>
    <pattern id="dots" width="20" height="20" patternUnits="userSpaceOnUse">
      <circle cx="10" cy="10" r="0.9" fill="#0A0A0A" opacity="0.16"/>
    </pattern>
  </defs>
  <rect width="540" height="380" fill="#FAFAF8"/>
  <rect width="540" height="380" fill="url(#dots)"/>
  <rect x="0" y="0" width="540" height="6" fill="#002FA7"/>
  <text x="40" y="58" font-family="Segoe UI, Microsoft YaHei" font-size="11" font-weight="600" letter-spacing="1.6" fill="#0A0A0A">QUOTADECK</text>
  <text x="40" y="92" font-family="Microsoft YaHei, Segoe UI" font-size="22" font-weight="700" fill="#0A0A0A">拖到 Applications 即可安装</text>
  <text x="40" y="114" font-family="Segoe UI, Microsoft YaHei" font-size="12" fill="#5A5A58">Drag QuotaDeck to Applications to install</text>
  <line x1="40" y1="134" x2="500" y2="134" stroke="#0A0A0A" stroke-width="0.6" opacity="0.5"/>
  <line x1="206" y1="216" x2="326" y2="216" stroke="#002FA7" stroke-width="2"/>
  <path d="M326 209 L338 216 L326 223 Z" fill="#002FA7"/>
  <text x="40" y="336" font-family="Microsoft YaHei, Segoe UI" font-size="10" fill="#5A5A58">首次打开如被拦下：在“系统设置 › 隐私与安全性”里点“仍要打开”。</text>
  <text x="40" y="352" font-family="Segoe UI, Microsoft YaHei" font-size="10" fill="#5A5A58">Blocked on first launch? System Settings › Privacy &amp; Security › Open Anyway.</text>
</svg>`
fs.writeFileSync(res('dmg-background.png'), png(dmg, 540))
fs.writeFileSync(res('dmg-background@2x.png'), png(dmg, 1080))
console.log('icons written to resources/')
