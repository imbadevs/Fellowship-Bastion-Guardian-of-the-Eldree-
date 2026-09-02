# Fellowship Bastion: Guardian of the Eldree

Portrait-mode 3D tower defense on a hex grid. three.js + TypeScript + Vite.

See [docs/GDD.md](docs/GDD.md) for a short design overview (premise, loop,
Constructs, controls), or [docs/PLAN.md](docs/PLAN.md) for the full technical
plan and milestone breakdown.

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
- Tap a placed Construct to inspect it; long-press-drag it to move, merge, or
  sell it (60% refund) — see Merging below
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
- The shop is docked at the bottom of the screen for the whole Prep period —
  not a modal. The board stays visible and interaction-adjacent the entire
  time; opens automatically before every wave, including the very first
- Always 3 building cards, weighted by rarity, weights shifting as waves
  progress. Every affordable card is buyable, not just one — a bought card
  turns into a compact "✓ Built" mark and stays that way; the other slots
  remain live. A card is only marked bought once its Construct actually lands
  on a tile, so a cancelled or mistapped placement leaves it buyable again
  rather than falsely marking it sold
- Reroll (10g, +5g each use that Prep period) redraws all 3 and clears every
  "Built" mark, gated on gold at the data layer as well as in the UI. There is
  no "skip" action — with nothing to dismiss, the player just buys what they
  want and taps Ready when done
- Buying a card arms the same drag-or-tap placement M2 built; cost is spent at
  commit, so backing out of a placement costs nothing
- A `Begin Wave N` control replaces the dev "Start" button — enabled once
  nothing is mid-placement and combat isn't running
- Wave clear grants a gold bonus and partially heals the Eldree, then the shop
  dock reopens automatically; it hides again the instant a wave starts
- The Eldree sits at the board's centre with no inherent front — the Shadow
  Army attacks from every direction. `WaveDef.lanes` (1–6) spreads the horde
  across evenly-spaced directions around the full circle, the main pressure
  dial: the same enemy count surrounding the board from six sides is a very
  different problem than the same count funnelling in from one
- The board is combat-only during a wave: long-press-dragging a Construct to
  move/merge/sell it is disabled, so a tap mid-fight is just the read-only
  status readout (name, blurb, live HP) it always is
- A fresh run (via defeat → "Begin again") resets gold as well as the board —
  a defeated run's leftover economy no longer carries into the next attempt
- The old "buy anything, anytime" tray is gone; the dev bar is now genuinely
  dev-only (Smite, +200 gold, Frame, Reset, speed toggle)

The run loop is real and playable end to end: shop → place → ready → fight →
reward → shop, indefinitely, with no scripted wave cap.

**Move, Merge and Sell are one drag gesture.** Tapping a Construct only ever
shows a read-only info card (name, blurb, live HP mid-combat) — no buttons.
To act on it, press and hold; after a beat (~180ms) it picks up, and where
you drop it decides the outcome:

- **Drop on an empty tile** — moves it there, free.
- **Drop on a matching Construct** — merges the two into the tier-2 upgrade,
  free (the existing Construct was already paid for). Every eligible partner
  on the board lights up violet the moment the drag starts, and the ghost
  preview turns violet over the specific tile you're hovering. The four
  spawner families have a tier-2 upgrade (Barracks/War Lodge, Archery
  Range/Bowspire, Knight's Hall/Bastion Keep, Mage Spire/Arcane Obelisk);
  defensive structures have no tier-2 yet, so they're never mergeable. A
  merge carries the combined garrison into the upgrade rather than mustering
  from zero; survivors beyond the new roster cap (two full Barracks is 6
  Warriors, a War Lodge only holds 5) have no slot to keep and are released.
- **Drop on the recycle icon** — sells it for the standard refund. The icon
  appears over the shop dock only while a Construct is being dragged, and
  lights up as you hover it.

A quick drag starting on the same tile still pans the camera as normal —
only a press that stays still past the hold delay counts as a pickup, which
is what lets picking-up and panning coexist on the same tile without one
stealing the other. Buying straight into an upgrade still works too: drag a
shop card and drop it directly onto a matching Construct (or tap the card,
then tap that Construct) — same violet preview, costs exactly what the card
costs standing alone. All of this is hidden during combat — the board is
look-but-not-touch while a wave runs.

**Cooldown bars** — every Construct with a timer (spawn interval for
spawners, attack cooldown for turrets) shows a small charge-up bar floating
just above its roofline: empty right after a spawn/shot, full and ready when
it fires again. Positioned per building using a measured, not hand-authored,
height (`buildingHeight` in `BuildingShapes.ts`), so it can never drift out
of sync with a shape that gets retuned later. One InstancedMesh pair (track +
fill) for the whole board — a flat 2 extra draw calls whether 1 Construct is
built or 60. Defensive structures with neither a spawner nor a
weapon (Palisade, Healing Shrine) show no bar, since there is no cooldown to
show. Also fixed alongside this: a freshly placed Construct's first spawn now
waits a full cooldown like every one after it, instead of the old 35%
head-start — the bar reads correctly against that real timing.

**Camera reframed for an omnidirectional attack.** With the horde attacking
from every side again, the board is framed close to centred (`FRAME_BIAS`
settled at a modest +0.16 — enough to leave room for the bottom-docked shop,
without favouring "up" the way the top-only design briefly did). The fit
distance still folds in a smaller `APPROACH_VISIBILITY` margin beyond the
board's own edge so nearby spawns read as on-screen sooner — though with
attacks coming from everywhere at once, no single framing can keep the whole
spawn ring visible simultaneously the way a one-directional design could;
that is an inherent trade-off of going wide rather than a bug to chase.
