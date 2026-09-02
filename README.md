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
- Board starts at rings 0–2 (19 tiles) and grows outward each time a hard
  wave is held (see below) — 37, 61, 91, then 127 tiles at full size after
  wave 20; locked rings are not drawn at all, and the
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

**Hard waves set the run's pacing.** Every 5th wave (5, 10, 15, …) is a hard
wave: whatever that wave would have been, half again as many foes, from one
more direction, arriving closer together. It is layered on top of the base
wave rather than authored separately, so it reads as the same fight one notch
harder — and it is announced before it starts, on the `Begin Wave N · Hard`
button and in the toast, so it can be built toward rather than sprung.

Holding one is what expands the bastion: each hard wave cleared unlocks the
next ring (19 → 37 → 61 → 91 → 127 tiles, full size after wave 20) and grows
the Eldree with it. Expansion is the reward for the spike that just happened
rather than a schedule of its own, which makes the whole run one repeating
beat: build up, survive the spike, claim the ground, repeat.

**Upgrading has to beat spamming, or it is not a decision.** It did not. A
Siege Ballista put out 53.8 dps where the four Ballistas it was merged from
put out 75.6 — merging a turret line was a straight downgrade you paid four
purchases for, so covering the board in cheap Constructs was simply the
better play. Every family is now retuned so a tier's output beats the sum it
replaced, and tier scaling reaches past raw numbers: a higher-tier garrison
also reaches further and swings faster, so concentration changes where you
want it standing rather than only how big it hits. Measured as the fewest
tiles needed to hold a wave:

| wave | foes | tier 1 | tier 2 | tier 3 |
|---|---|---|---|---|
| 11 | 62 | 13 | 5 | 4 |
| 15 | 128 | 20 | 8 | 4 |
| 20 | 204 | 26 | 8 | 5 |
| 25 | 321 | 34 | 13 | 5 |

Spamming tier 1 through wave 25 wants 34 tiles and the gold to keep buying
them; upgrading holds the same wave on 5.

**Constructs are destructible, and the horde sieges.** They were not, in
practice: a Construct's armour plus the engagement limit that stops an enemy
grinding on one forever meant an Orc removed about 4% of a War Lodge before
giving up and rerouting, so nothing on the board was ever really at risk.
Enemies now carry a separate `siege` multiplier against Constructs — Orc
2.5x, Troll 4.5x, Wraith 1.5x — which keeps the enemy roster distinct: the
Troll is the thing that breaks your line, the Orc is the thing that gets
past it, and the Wraith was never interested in your buildings anyway. The
attrition falls hardest on spread-out cheap Constructs: holding wave 25 on
tier 1 now costs 8 buildings destroyed along the way, tier 2 costs 1, and
tier 3 costs none — so upgrading protects the investment as well as
out-performing it.

**The curve compounds per era, not per wave.** Because the player's strength
jumps in steps — a new ring is a third more tiles to build on, bought with
the gold from holding the spike — a horde that grew by a flat amount each
wave fell further behind with every era. Past the authored table the counts
now compound by era (~45% per era, plus a gentle ~8% between waves inside
one), so each ring earned is met by a horde that grew in the same step:
era 2 opens at 61 foes, era 3 at 92, era 4 at 141, era 5 at 218. Trolls and
Wraiths grow faster than Orcs on top of that, so the elite share climbs from
40% to about 50% — later eras are answered with the right Constructs rather
than simply more of them, since armour and magic resistance are the two
problems raw volume cannot solve.

**Move, Merge and Sell are one drag gesture.** Tapping a Construct only ever
shows a read-only info card (name, blurb, live HP mid-combat) — no buttons.
To act on it, press and hold; after a beat (~180ms) it picks up, and where
you drop it decides the outcome:

- **Drop on an empty tile** — moves it there, free.
- **Drop on a matching Construct** — merges the two into the next tier, free
  (the existing Construct was already paid for). All eight families chain
  tier 1 → 2 → 3; tier 3 is merge-only, never drafted. A merge carries the
  combined garrison into the upgrade rather than mustering from zero;
  survivors beyond the new roster cap (two full Barracks is 6 Warriors, a War
  Lodge only holds 5) have no slot to keep and are released. **Upgrading beats
  spreading**, and deliberately so — see below.
- **Drop on the recycle icon** — sells it for the standard refund. The icon
  appears over the shop dock only while a Construct is being dragged, and
  lights up as you hover it.

A quick drag starting on the same tile still pans the camera as normal —
only a press that stays still past the hold delay counts as a pickup, which
is what lets picking-up and panning coexist on the same tile without one
stealing the other. Buying straight into an upgrade still works too: drag a
shop card and drop it directly onto a matching Construct (or tap the card,
then tap that Construct) — costs exactly what the card costs standing alone.
All of this is hidden during combat — the board is look-but-not-touch while
a wave runs.

**Finding a merge, mid-drag.** Whatever you're holding — a shop card or a
Construct lifted off the board — every Construct on the board it could merge
into blinks violet the moment it's armed, so "what can this combine with?"
is answered before you go looking. Over a specific match, two more things
happen: the ghost switches to the *upgrade's* silhouette (what you'd
actually get, not what you're carrying), and, when dragging one Construct
onto another, a violet beam links the two so the pairing is unambiguous.

**Floating indicators** — a Construct carries up to two, stacked above its
roofline. Both are positioned from a measured, not hand-authored, height
(`buildingHeight` in `BuildingShapes.ts`), so neither can drift out of sync
with a shape that gets retuned later.

- **Health bar**, nearest the roofline, and *only while hurt* — at full
  health it would be noise on every tile, so its presence alone is the
  signal that something is wrong. The fill runs green → amber → red as the
  Construct is worn down, tinted per instance so one mesh pair covers the
  whole board.
- **Cooldown ring**, stacked above it: a radial sweep that closes clockwise
  from the top, empty right after a spawn/shot and full when it fires again.
  Per-instance progress rides an instanced attribute and the sweep is done
  in the fragment shader, so the entire board is **one** draw call — cheaper
  than the two the old horizontal bar needed, since track and fill share the
  same pixels. Defensive structures with neither a spawner nor a weapon
  (Palisade, Healing Shrine) show no ring, since there is no cooldown.

The slots are fixed, so a Construct taking its first hit does not shove its
ring upward mid-fight; a healthy one simply leaves the lower slot empty.
Also fixed alongside the original bars: a freshly placed Construct's first
spawn waits a full cooldown like every one after it, instead of the old 35%
head-start — the indicator reads correctly against that real timing.

**Camera reframed for an omnidirectional attack.** With the horde attacking
from every side again, the board is framed close to centred (`FRAME_BIAS`
settled at a modest +0.16 — enough to leave room for the bottom-docked shop,
without favouring "up" the way the top-only design briefly did). The fit
distance still folds in a smaller `APPROACH_VISIBILITY` margin beyond the
board's own edge so nearby spawns read as on-screen sooner — though with
attacks coming from everywhere at once, no single framing can keep the whole
spawn ring visible simultaneously the way a one-directional design could;
that is an inherent trade-off of going wide rather than a bug to chase.
