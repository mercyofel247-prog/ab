# web — Scroll Morph Hero playground

A minimal **Vite + React + TypeScript + Tailwind CSS v4** app that hosts the
interactive `scroll-morph-hero` component using the shadcn-style
`components/ui` structure.

## Why this folder exists

The repository root is a **video-rendering project** (Remotion + HyperFrames).
It has no shadcn/Tailwind **web** app, and `scroll-morph-hero` is a fully
interactive, browser-driven hero — it relies on `wheel`/`touch`/`mousemove`
listeners, `ResizeObserver`, and Framer Motion scroll springs. Those cannot run
inside Remotion's deterministic, frame-by-frame render pipeline, so the
component was given a proper browser home here in `web/` rather than being
forced into `remotion-app/`.

## Project structure

```
web/
├── index.html
├── src/
│   ├── main.tsx                     # React entry
│   ├── App.tsx                      # renders the demo
│   ├── index.css                    # Tailwind v4 + tw-animate-css + theme tokens
│   └── components/
│       ├── demo.tsx                 # usage example
│       └── ui/
│           └── scroll-morph-hero.tsx  # the integrated component
├── vite.config.ts                   # React + Tailwind v4 plugins, "@" -> ./src alias
├── tsconfig.app.json                # "@/*" path mapping
└── package.json
```

### Why `components/ui`

This is the shadcn/ui convention. Keeping copy-pasted primitives in
`components/ui` (separate from your own app components) makes it obvious which
files are vendored building blocks you can re-sync from a registry, keeps the
`@/components/ui/...` import path stable across a project, and lets a future
`shadcn` CLI (`npx shadcn@latest add ...`) drop new components in without
clashing with your app code. The `@` alias points at `src/`, so the component
imports as `@/components/ui/scroll-morph-hero`.

## Getting started

```bash
cd web
npm install
npm run dev      # start the dev server
npm run build    # type-check (tsc -b) + production build
npm run preview  # serve the production build
```

## Dependencies

- **framer-motion** — the animation engine the component is built on.
- **tailwindcss** + **@tailwindcss/vite** — Tailwind CSS v4 (no `tailwind.config.js`;
  configured via `@import "tailwindcss"` and `@theme` in `src/index.css`).
- **tw-animate-css** — imported by `src/index.css` (as specified by the component).

## Reproducing this setup from scratch (if starting a fresh project)

If you don't already have a Tailwind + TypeScript project, this app was created
equivalently to:

```bash
# 1. Scaffold a Vite React + TS app
npm create vite@latest web -- --template react-ts
cd web

# 2. Install Tailwind CSS v4 (Vite plugin) + the component's deps
npm install framer-motion tw-animate-css
npm install -D tailwindcss @tailwindcss/vite

# 3. (optional) initialize shadcn to formalize components/ui + the "@" alias
npx shadcn@latest init
```

Then add `@tailwindcss/vite` to `vite.config.ts`, point the `@` alias at
`./src`, and replace `src/index.css` with the Tailwind v4 imports.

## Notes

- Images are loaded from the 21st.dev CDN (the URLs shipped with the component).
  Swap the `IMAGES` array in `scroll-morph-hero.tsx` for your own assets as
  needed.
- `noUnusedLocals` / `noUnusedParameters` are relaxed in `tsconfig.app.json` so
  the vendored component compiles verbatim.
