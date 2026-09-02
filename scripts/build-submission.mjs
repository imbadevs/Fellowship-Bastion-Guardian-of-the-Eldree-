/**
 * Builds the competition submission bundle.
 *
 * The rules are specific and they do not match a normal Vite build, so this
 * script produces a second, differently-shaped output rather than bending the
 * main one:
 *
 *   - `index.html` at the top level of the zip, containing all of our own game
 *     code in readable, unminified form.
 *   - Third-party libraries in `vendor/`, referenced by relative path, and
 *     explicitly NOT inlined into index.html.
 *   - No network access at runtime: nothing is fetched, so there is nothing to
 *     fetch from a CDN.
 *
 * three ships ESM only, split across `three.module.js` and `three.core.js`, so
 * it is bundled here into one classic script that assigns `window.THREE`. That
 * satisfies "libraries live in vendor/" and has a useful side effect: classic
 * scripts are not subject to the module CORS rules, so the build also runs when
 * index.html is opened straight off the filesystem, not just over http.
 */
import { build } from 'vite'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(root, 'submission')
const staging = path.join(root, '.submission-staging')

/** three, bundled from its ESM sources into one classic script exposing `THREE`. */
async function buildVendor() {
  await build({
    root,
    logLevel: 'warn',
    configFile: false,
    build: {
      outDir: path.join(staging, 'vendor'),
      emptyOutDir: true,
      target: 'es2022',
      // The library is third-party; only *our* code has to stay readable.
      minify: true,
      lib: {
        entry: path.join(root, 'node_modules/three/build/three.module.js'),
        name: 'THREE',
        formats: ['iife'],
        fileName: () => 'three.js',
      },
    },
  })
  return readFile(path.join(staging, 'vendor/three.js'), 'utf8')
}

/** Our own game code: one unminified IIFE, with three left external as a global. */
async function buildGame() {
  await build({
    root,
    logLevel: 'warn',
    configFile: false,
    build: {
      outDir: path.join(staging, 'game'),
      emptyOutDir: true,
      target: 'es2022',
      minify: false,
      lib: {
        entry: path.join(root, 'src/main.ts'),
        name: 'FellowshipBastion',
        formats: ['iife'],
        fileName: () => 'game.js',
      },
      rollupOptions: {
        external: ['three'],
        output: { globals: { three: 'THREE' } },
      },
    },
  })
  return readFile(path.join(staging, 'game/game.js'), 'utf8')
}

function page(css, game) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover" />
  <meta name="theme-color" content="#0a0e14" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <title>Fellowship Bastion: Guardian of the Eldree</title>
  <style>
${css.trim()}
  </style>
</head>
<body>
  <div id="app">
    <canvas id="game"></canvas>
    <div id="ui"></div>
  </div>

  <!-- Third-party library, kept out of this file and loaded by relative path. -->
  <script src="vendor/three.js"></script>

  <!-- All of our own game code, unminified. -->
  <script>
${game.trimEnd()}
  </script>
</body>
</html>
`
}

async function main() {
  await rm(out, { recursive: true, force: true })
  await rm(staging, { recursive: true, force: true })
  await mkdir(path.join(out, 'vendor'), { recursive: true })

  const [vendor, game, css] = [
    await buildVendor(),
    await buildGame(),
    await readFile(path.join(root, 'src/ui/styles.css'), 'utf8'),
  ]

  await writeFile(path.join(out, 'vendor/three.js'), vendor)
  await writeFile(path.join(out, 'index.html'), page(css, game))
  await rm(staging, { recursive: true, force: true })

  // index.html must sit at the top level of the zip, not inside a folder.
  const zip = path.join(root, 'fellowship-bastion.zip')
  await rm(zip, { force: true })
  await run('zip', ['-r', '-q', zip, 'index.html', 'vendor'], { cwd: out })

  return { zip, out }
}

main().then(({ zip }) => console.log('built', path.relative(root, zip)))
