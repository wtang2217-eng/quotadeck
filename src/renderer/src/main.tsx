// The React refresh preamble is imported as a module (empty in production) so the strict CSP can stay 'self'.
import '@vitejs/plugin-react/preamble'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createMockApi } from './mock'
import './styles.css'

const api = window.qd ?? createMockApi()

createRoot(document.getElementById('root')!).render(<App api={api} />)
