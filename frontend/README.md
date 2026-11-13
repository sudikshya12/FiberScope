# FiberScope frontend

React 19 · TypeScript · Vite · Tailwind v4 · React Router · TanStack Query · React Flow · Recharts · Motion.

```bash
npm ci
npm run dev        # http://127.0.0.1:5188 (proxies /api → http://127.0.0.1:8077; override with FIBERSCOPE_API_URL)
npm test           # Vitest component tests
npm run test:e2e   # Playwright E2E (starts its own isolated API + Vite on 8078/5189)
npm run build
```

See the repository [README](../README.md) and [docs/](../docs) for everything else.
