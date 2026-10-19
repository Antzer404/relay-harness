import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/saira/wdth.css'
import './styles/endfield.css'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('root element missing')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)
