import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { LanApp } from './LanApp'
import '../../renderer/src/styles.css'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><LanApp /></StrictMode>)
