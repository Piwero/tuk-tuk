# frontend

TypeScript app scaffolded with Vite + React, linted with ESLint,
formatted with Prettier, tested with Vitest.

## Setup

```bash
npm install
```

## Run

In Docker with HMR (from the repo root):

```bash
mise run frontend:dev
```

Or natively:

```bash
npm run dev
```

Then open http://localhost:5900.

API calls go to `VITE_API_BASE_URL` (set in the repo-root `.env`, default
`http://localhost:8900`).

## Common commands

| Task          | Command             |
| ------------- | ------------------- |
| Dev server    | `npm run dev`       |
| Build         | `npm run build`     |
| Preview build | `npm run preview`   |
| Lint          | `npm run lint`      |
| Format        | `npm run format`    |
| Typecheck     | `npm run typecheck` |
| Test          | `npm test`          |

## Layout

```
frontend/
├── src/
│   ├── main.tsx      # Entrypoint
│   ├── App.tsx       # Root component
│   └── test/setup.ts # Vitest config
├── public/           # Static assets served as-is
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── eslint.config.js
└── Dockerfile
```
