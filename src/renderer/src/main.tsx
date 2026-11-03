// The React refresh preamble is imported as a module (empty in production) so the strict CSP can stay 'self'.
import '@vitejs/plugin-react/preamble'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createMockApi } from './mock'
// Inter ships with the app (no network at runtime) for Latin text and numbers; Chinese uses the system fonts.
import '@fontsource-variable/inter'
import './styles/index.css'
import { TrayView } from './pages/TrayView'

const api = window.qd ?? createMockApi()
// The tray popover loads the same page with ?view=tray and sizes its window to the content.
const tray = new URLSearchParams(location.search).get('view') === 'tray'
if (tray) document.documentElement.dataset.view = 'tray'

createRoot(document.getElementById('root')!).render(tray ? <TrayView api={api} /> : <App api={api} />)
