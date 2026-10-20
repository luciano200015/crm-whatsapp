import '@fontsource/public-sans/300.css'
import '@fontsource/public-sans/400.css'
import '@fontsource/public-sans/600.css'
import '@fontsource/public-sans/700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router/dom'
import { AppProviders } from './AppProviders'
import './index.css'
import { router } from './router'
import { themeConfig } from './theme/theme.config'

document.title = themeConfig.brand.name

const root = document.getElementById('root')
if (!root) throw new Error('#root element missing in index.html')

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
)
