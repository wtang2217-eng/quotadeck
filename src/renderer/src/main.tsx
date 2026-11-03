// The React refresh preamble is imported as a module (empty in production) so the strict CSP can stay 'self'.
import '@vitejs/plugin-react/preamble'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createMockApi } from './mock'
// Fonts ship with the app (no network at runtime): Inter for text and numbers, JetBrains Mono for labels,
// Playfair Display for the editorial style. Chinese text uses the system fonts.
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import '@fontsource-variable/playfair-display'
import '@fontsource-variable/playfair-display/wght-italic.css'
import './styles/index.css'

const api = window.qd ?? createMockApi()

createRoot(document.getElementById('root')!).render(<App api={api} />)
