import { defineConfig } from 'vite'

/**
 * GitHub Pages serves a project site from a `/<repo-name>/` subpath rather
 * than the domain root, so every asset URL needs that prefix — but only for
 * the Pages build. Local dev and any other deploy target keep the root base.
 */
const base = process.env.GITHUB_PAGES === 'true' ? '/Fellowship-Bastion-Guardian-of-the-Eldree-/' : '/'

export default defineConfig({
  base,
  server: { port: 5173 },
  build: { target: 'es2022' },
})
