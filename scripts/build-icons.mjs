// Renders resources/icon.svg into the app icon (PNG + ICO) and the tray icons with a status dot.
//   npm run icons

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'
import pngToIco from 'png-to-ico'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const res = (...p) => path.join(root, 'resources', ...p)
const svg = fs.readFileSync(res('icon.svg'), 'utf8')

const png = (source, size) => new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng()

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
console.log('icons written to resources/')
