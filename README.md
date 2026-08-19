# Fellowship Bastion: Guardian of the Eldree

Portrait-mode 3D tower defense on a hex grid. three.js + TypeScript + Vite.

See [docs/PLAN.md](docs/PLAN.md) for the full technical plan and milestone breakdown.

## Running

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle
npm run typecheck
```

On desktop the game pillarboxes to a 9:16 frame, so what you see is the real
phone framing rather than a wide view that hides the portrait constraint.

## Status: M0-M5 complete

**M0 — foundation**
- Vite + strict TypeScript + three.js r185
- Fixed-step loop (`src/core/Loop.ts`): 30 Hz sim, interpolated render, catch-up
  cap, 1x/2x/4x speed as a tick multiplier rather than a `dt` scale
- Typed event bus, portrait canvas with safe-area insets, backgrounding pause
- Dev HUD asserting the mobile budget (draw calls, frame ms) from day one

**M1 — hex world**
- Pointy-top axial hex math with cube rounding (`src/hex/`)
- Board starts at rings 0–2 (19 tiles) and grows outward as rings unlock at
  waves 4 and 8, up to 61 tiles; locked rings are not drawn at all, and the
  camera eases back to reframe on each expansion
- Whole board renders as one `InstancedMesh`; top/side shading is baked into
  vertex colours so ring tinting stays on the instance attribute
- Camera rig: fixed pitch/yaw, clamped pan and pinch-zoom, aspect-aware fit
- Exact tile picking by raycasting the instanced mesh (no ground-plane
  approximation, so tile elevation does not skew the hit)
- Procedural Eldree placeholder

**M2 — placement**
- 12 Construct definitions in `src/data/buildings.ts`, including the spawn and
  weapon profiles M4 will read
- Procedural building meshes from a shared geometry kit (`src/view/MeshKit.ts`):
  parts merge into one geometry per type, so a six-part silhouette still costs
  one instanced draw
- Drag a card out of the tray to place, or tap the card then tap a tile — both
  paths share one commit routine
- Ghost preview with valid/invalid tint, per-tile validity rules, gold checked
  at both arm and commit time
- Tap a placed Construct to inspect, move (free) or sell (60% refund)
- Constructs orient outward from the Eldree, so walls face the horde
- Footprints are measured and fitted to 94% of the tile's inscribed circle, with
  damped height scaling so spires read tall without hiding the board

**M3 — simulation core**
- `src/sim/` is headless: struct-of-arrays entity storage over typed arrays,
  a preallocated uniform-grid broadphase, and a Dijkstra routing field
- Constructs raise path cost rather than blocking, so a wall slows the horde
  but can never seal the board
- Wraiths ignore routing entirely and drift straight at the Eldree
- Waves spawn on arcs around the board; arc count is the main pressure dial
- Position-correction separation keeps a packed horde from collapsing to a point
- Eldree health, damage flash, defeat screen, wave clear and reward

**M4 — combat**
- Spawners muster a garrison up to roster cap; units hold a formation slot
  around their Construct and respawn on cooldown when they fall
- Targets are sticky (kept while valid) rather than re-acquired every tick,
  which is what stops units flickering between equidistant foes
- Melee walks up to strike range and leashes back to station; ranged units
  hold position and kite anything that closes; Knights taunt nearby enemies
  onto themselves
- Archers and Ballistas fire arrows/bolts, Mages and Rune Wards fire homing
  motes with splash — all through one projectile pool, not per-unit state
- Armour uses a diminishing curve (never reaches immunity), magic resistance
  is a capped flat fraction — the split that makes Trolls a Mage problem and
  Wraiths an Archer problem
- Hurt actors tint toward red on their own silhouette instead of spawning a
  floating health bar per body
- Constructs are combat entities: they take fire, can be destroyed, and losing
  one releases its garrison and frees the tile

Measured at 375×812: **3 draw calls at wave 1**, rising to **15 with a fully
expanded board holding 51 Constructs**, and **14 mid-battle with 20+ foes, 6
units and projectiles in flight** — against a 60-call budget, at 120fps.

## Controls

One finger drags to pan, two fingers pinch to zoom, a tap selects a tile.
Drag a tray card onto a tile to build, or tap the card then tap the tile.
Escape (or tapping off-board) cancels a pending placement. Mouse wheel zooms on
desktop. The `Wave +1` / `+200` / `Frame` / `Clear` / speed buttons are
scaffolding, replaced by the phase machine and shop in M5.

## Architecture rule

`src/sim/` (from M3) must never import three.js. The simulation is headless,
deterministic and fixed-step; the view reconciles instances against sim state
each frame. This is what makes combat unit-testable in Node, makes the speed
multiplier exact, and keeps replays possible later.

## Debugging

In a dev build a `game` handle is exposed on `window` (stripped from production
by `import.meta.env.DEV`). Because the simulation is fixed-step you can drive it
by hand, which is the easiest way to inspect a wave without waiting for it:

```js
game.startWave()
for (let i = 0; i < 300; i++) game.sim.update(1 / 30)   // 10 seconds
game.sim.waveProgress
```

**M5 — the loop**
- The shop opens automatically before every wave, including the very first —
  1-of-3 building cards, weighted by rarity, weights shifting as waves progress
- Reroll (10g, +5g each use that visit) and Skip (+15g refund), both gated on
  gold at the data layer as well as in the UI
- Buying a card arms the same drag-or-tap placement M2 built; cost is spent at
  commit, so backing out of a placement costs nothing
- A `Begin Wave N` control replaces the dev "Start" button — enabled only once
  the shop is resolved and nothing is mid-placement
- Wave clear grants a gold bonus and partially heals the Eldree, then the next
  shop opens automatically
- The board is combat-only during a wave: tapping a Construct mid-fight shows
  a read-only status readout (name, blurb, live HP) instead of Move/Sell
- A fresh run (via defeat → "Begin again") resets gold as well as the board —
  a defeated run's leftover economy no longer carries into the next attempt
- The old "buy anything, anytime" tray is gone; the dev bar is now genuinely
  dev-only (Smite, +200 gold, Frame, Reset, speed toggle)

The run loop is real and playable end to end: shop → place → ready → fight →
reward → shop, indefinitely, with no scripted wave cap.
