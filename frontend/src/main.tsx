import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import * as RTooltip from '@radix-ui/react-tooltip'
import './index.css'
import App from './App'

const qc = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <MotionConfig reducedMotion="user">
        <RTooltip.Provider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </RTooltip.Provider>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
)
