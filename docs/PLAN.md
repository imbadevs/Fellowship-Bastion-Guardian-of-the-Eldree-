# Fellowship Bastion: Guardian of the Eldree — Technical Plan

Portrait-mode mobile 3D tower defense. three.js + TypeScript + Vite.
Hex-grid base building around a central Sacred Tree, wave combat, 1-of-3 shop draft.

---

## 1. Stack & assumptions

| Decision | Choice | Why |
|---|---|---|
| Renderer | three.js (WebGL2, `WebGLRenderer`) | Mature, instancing, good mobile support |
| Language | TypeScript, strict | Sim code is data-heavy; types pay for themselves by M4 |
| Build | Vite | Instant HMR, tiny config |
| UI | DOM/CSS overlay on top of canvas | Text/buttons/cards in WebGL on mobile is a trap: no a11y, bad text rendering, huge effort. Canvas = world only |
| State | Plain TS classes + a typed event bus | No Redux/ECS library. ~300 entities does not need a framework |
| Physics | None | Custom 2D-on-XZ movement + circle overlap. Cannon/Rapier is dead weight here |
| Assets | Phase 1: procedural primitives. Phase 2: hand-authored glTF (Draco+KTX2) | Unblocks all gameplay work before art exists |
| Shipping | Phase 1: web (itch.io / static host). Phase 2: Capacitor wrap for App Store / Play | Same codebase, no rewrite |
| Audio | Howler.js | WebAudio unlock on iOS is fiddly; Howler already solved it |

**Target:** 60 fps on iPhone 12 / Snapdragon 7-series. Budget: ≤60 draw calls, ≤250 concurrent entities, ≤80 MB GPU memory.

---

## 2. Project layout

```
src/
  main.ts                  bootstrap, canvas, loop start
  core/
    Loop.ts                fixed-step accumulator (sim 30 Hz, render vsync, interpolated)
    Rng.ts                 mulberry32 seeded PRNG — reproducible runs, seed sharing
    Events.ts              typed emitter (sim -> view -> UI, one direction)
    Pool.ts                generic object pool
    Save.ts                localStorage meta-progression
  hex/
    Hex.ts                 axial coords (q,r), math, neighbors, ring, spiral, distance
    HexLayout.ts           pointy-top layout consts, hex <-> world XZ conversion
    HexGrid.ts             cell map, occupancy, buildability, ring unlocking
  sim/                     ← headless, zero three.js imports. Unit-testable.
    World.ts               entity storage (typed arrays / struct-of-arrays), spawn/kill
    SpatialHash.ts         uniform grid broadphase for target acquisition
    FlowField.ts           BFS cost field over hex+offgrid toward Eldree
    systems/
      WaveSystem.ts        spawn schedule, wave clear detection
      SpawnerSystem.ts     buildings emit units on cooldown
      TargetingSystem.ts   acquire/retain targets, threat rules
      MovementSystem.ts    steering, station-holding, separation
      CombatSystem.ts      attack timers, damage resolution, armor/resist
      ProjectileSystem.ts  arrows / bolts / AoE
      StatusSystem.ts      buffs, DoT, slow, stun
      DeathSystem.ts       corpse cleanup, gold drops
      AuraSystem.ts        adjacency synergies from buildings
  view/
    Renderer.ts            scene, lights, tone mapping, resize
    CameraRig.ts           portrait framing, clamped pan/pinch, shake
    HexGridView.ts         one InstancedMesh for all tiles + highlight overlay
    UnitView.ts            InstancedMesh per archetype, sim-id -> instance index map
    BuildingView.ts        InstancedMesh per building type
    ProjectileView.ts      instanced quads/cylinders
    FxSystem.ts            pooled sprite particles, damage numbers, blob shadows
    Picking.ts             raycast screen -> ground plane -> hex coord
  game/
    GameState.ts           phase machine
    Economy.ts             gold, income, costs
    Shop.ts                1-of-3 building offer, rarity weights, reroll/banish
    Draft.ts               1-of-3 Blessing offer (roguelike modifiers)
    Modifiers.ts           stat-modifier stack applied to archetypes
    Placement.ts           drag/drop controller, validity, ghost preview
  data/
    buildings.ts units.ts enemies.ts waves.ts blessings.ts balance.ts
  ui/
    Hud.ts ShopPanel.ts DraftPanel.ts DragGhost.ts WaveBanner.ts GameOver.ts
    styles.css
```

**Hard rule:** `sim/` never imports three.js. The view reads sim state each frame and reconciles instances. This keeps combat deterministic, testable in Node, and makes it trivial to add replays or server validation later.

---

## 3. The hex grid

**Pointy-top, axial coordinates.** Pointy-top hexes are taller than wide (`w = √3·s`, `h = 2·s`), so a radius-N field packs into a portrait aspect better than flat-top.

```ts
// axial -> world (Y is up, board lies on XZ)
x = size * (Math.sqrt(3) * q + Math.sqrt(3)/2 * r)
z = size * (3/2 * r)
```

Layout:

| Ring | Radius | Cells | Role |
|---|---|---|---|
| 0 | center | 1 | **Eldree** — the Sacred Tree. Lose when its HP hits 0 |
| 1 | inner | 6 | Buildable at start. Safest — put Mages/Archers here |
| 2 | mid | 12 | Buildable at start |
| 3 | outer | 18 | Unlocks wave 4 |
| 4 | rim | 24 | Unlocks wave 8. Defensive Structures get a bonus here |
| 5 | edge | — | Not buildable. Enemy approach lane / spawn arcs |

61 buildable+center cells at full expansion. Enemies spawn off-grid on 6 arcs (one per hex direction), unlocked progressively: 2 arcs → 3 → 4 → 6 as waves escalate. Expanding rings *is* the progression curve — early game is cramped and forces hard placement choices.

**Enemy pathing:** BFS flow field from the Eldree outward over the hex graph, with buildings as high-cost (not impassable — no maze-blocking exploit; enemies attack through). Recomputed only on build/destroy, not per frame. Cost ≈ 61 cells; free.

---

## 4. Simulation model

### Entity archetypes
Struct-of-arrays over typed arrays, capacity 512, free-list for reuse:
`posX/posZ, velX/velZ, hp, maxHp, team, archetype, targetId, atkCooldown, stationX/stationZ, flags`.

### Units (player, spawned by buildings)

| Class | Role | Range | Behavior |
|---|---|---|---|
| **Warrior** | Cheap DPS bulk | Melee | Advances to a station hex 1 ring outward from its spawner, engages nearest enemy |
| **Knight** | Tank / blocker | Melee | Holds a forward station, **taunts** — enemies in radius must retarget to it |
| **Archer** | Single-target ranged | 3 hex | Holds near spawner, kites backward if an enemy closes |
| **Mage** | AoE, magic damage | 2.5 hex | Slow attack, splash — the answer to Troll packs and armored waves |

Units are **not** individually controlled. Each spawner keeps a live roster (cap 3–6). Dead units respawn on cooldown. Player agency is in *what* they build and *where*, not in micro.

### Enemies (Shadow Army)

| Enemy | Trait | Counter |
|---|---|---|
| **Orc** | Fast, weak, swarms | Mage splash |
| **Troll** | High HP + physical armor, slow, hits buildings hard | Mage magic damage |
| **Wraith** | Ignores the front line — floats past to the Eldree, immune to physical | Archer + Mage, Knight taunt does not hold it |

Later tiers: Orc Shaman (heals), Troll Bruiser (armored elite), Wraith Lord (wave boss with a shield phase).

### Combat resolution
```
physicalDmg = atk * (100 / (100 + armor))
magicDmg    = atk * (1 - resist)      // resist capped at 0.75
```
Attack timers, not per-frame damage. Deterministic order: entities processed by id ascending, all RNG from the seeded stream.

### Gold
Enemies drop gold on death, auto-collected (no pickup micro — bad on mobile). Wave-clear bonus scales with time-remaining and Eldree HP kept intact, rewarding decisive defense.

---

## 5. Game loop / phase machine

```
BOOT → RUN_START
  ↓
PREP        player places anything held, reads the wave preview, taps READY
  ↓
WAVE        enemies spawn on schedule; sim runs; 2× / 4× speed toggle available
  ↓          (all enemies dead)
REWARD      gold tally, Eldree HP restored partially
  ↓
SHOP        1-of-3 building cards. Buy one (or reroll for a small gold cost, or skip for gold back)
  ↓
PLACE       drag the purchased Construct onto a valid hex; sell/move existing buildings free during this phase
  ↓
[every 3rd wave] DRAFT   1-of-3 Blessings — permanent run-wide modifiers
  ↓
back to PREP (wave++)   |   GAME_OVER if Eldree HP ≤ 0
```

Speed toggle (1×/2×/4×) is a fixed-step multiplier — it runs more sim ticks per frame, so it never changes outcomes.

---

## 6. Shop & drafting

**Shop (every wave):** 3 cards drawn from a weighted pool. Weights shift by wave — commons dominate waves 1–5, rares appear from wave 4, epics from wave 9. Duplicate offers are allowed and *desirable* (stacking the same spawner is a real strategy). Reroll costs 10g, +5g each use within a wave. Skip refunds 15g.

**Blessings (every 3rd wave — the "high-frequency drafting"):** run-wide modifiers, drafted 1-of-3. Design categories:
- *Class buffs* — "Archers gain +25% attack speed"
- *Behavior rewrites* — "Mage attacks chain to 2 additional targets"
- *Economy* — "+2 gold per enemy slain"
- *Eldree* — "The Eldree regenerates 5 HP per wave"
- *Build rules* — "Defensive Structures cost 30% less" / "+1 unit roster cap for all spawners"
- *Risk* — "Enemies deal +20% damage, but drop double gold"

All Blessings resolve through one `Modifiers` stack (additive tiers, then multiplicative tiers) applied when an archetype's effective stats are computed. That single choke point is what makes 60+ Blessings tractable instead of a special-case nightmare.

**Adjacency synergies** (positional depth, the reason a hex grid earns its place): buildings check their 6 neighbors on placement and grant auras — e.g. a Barracks adjacent to a Mage Spire gives its Warriors a magic-damage-on-hit proc; two Watchtowers adjacent share targeting. Recomputed only on build change.

---

## 7. Content targets (v1)

- **12 buildings**: 4 spawners (Barracks / Archery Range / Knight's Hall / Mage Spire) × 2 tiers each = 8, plus 4 Defensive Structures (Palisade, Ballista Turret, Rune Ward, Healing Shrine)
- **4 unit classes** × 3 tiers (stat scaling driven by building tier)
- **9 enemy types**, 3 bosses
- **20 waves** for a full run, ~15–20 min
- **40 Blessings**

All of it lives in `src/data/*.ts` as plain typed objects. Balance is a data edit, never a code edit.

---

## 8. Mobile performance strategy

1. **Instancing everywhere.** One `InstancedMesh` per archetype, per building type, per projectile type. ~15 draw calls for the whole board.
2. **No real-time shadows.** One instanced blob-shadow plane with an alpha texture. Bake ambient occlusion into the hex tile texture.
3. **No skeletal animation in v1.** Units are stylized low-poly with procedural motion (bob, lean-into-attack, squash on hit) written directly into the instance matrix. Skinning gets evaluated at M7 only if it survives a perf test.
4. **Object pooling** for projectiles, damage numbers, particles, corpses. Zero allocation in the steady-state frame — GC pauses are the #1 cause of mobile jank.
5. **Fixed 30 Hz sim, interpolated render.** Decouples visual smoothness from sim cost and makes the speed toggle exact.
6. **Cap `pixelRatio` at 2**, render at 0.85 scale on low-end with an FXAA-ish pass, or just accept it.
7. **KTX2 + Draco** on all shipped assets. Texture atlas per material family.
8. **Budget assert in dev builds**: log a warning when draw calls > 60 or frame time > 16 ms for 30 consecutive frames.

---

## 9. Milestones

| # | Milestone | Deliverable | Est. |
|---|---|---|---|
| **M0** | Scaffold | Vite + TS + three.js, portrait canvas, resize, fixed-step loop, FPS/draw-call overlay | 0.5d |
| **M1** | Hex world | Instanced hex grid, Eldree placeholder at center, camera rig with clamped pan/pinch, tap→hex picking with highlight | 1.5d |
| **M2** | Placement | Building data defs, drag-and-drop from a DOM tray onto a hex, ghost preview, validity rules, sell/move | 1.5d |
| **M3** | Sim core | World/SoA storage, spatial hash, flow field, enemy spawn + march to Eldree, Eldree takes damage, game over | 2d |
| **M4** | Combat | Spawners emit units, stationing, targeting, melee + projectiles, damage/armor, death, gold drops | 3d |
| **M5** | Loop | Phase machine, wave schedule data, shop panel with 1-of-3 + reroll, reward tally, full playable run to wave 10 | 2.5d |
| **M6** | Drafting | Modifier stack, Blessing draft panel, 15 starter Blessings, adjacency auras | 2d |
| **M7** | Content | Full 12 buildings / 9 enemies / 20 waves / 40 Blessings, first balance pass | 3d |
| **M8** | Juice | Hit flashes, screen shake, damage numbers, wave banners, VFX, audio, haptics, tutorial | 3d |
| **M9** | Mobile hardening | Device testing, perf pass to budget, safe-area insets, backgrounding/pause, Capacitor wrap | 2.5d |
| **M10** | Meta | Persistence, run seeds, unlocks, stats screen, difficulty ascensions | 2d |

**≈ 23 working days to a shippable v1.** M0–M5 (~11d) gets a genuinely playable prototype worth testing on a real device.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| **Unit AI feels dumb / units clump into a blob** | Station-based positioning + separation steering from day one, not "everyone chase nearest". Budget a full day in M4 for this — it is the single biggest determinant of whether the game reads as tactical or as mush |
| **Portrait framing can't show a radius-4 grid legibly** | Prototype the camera in M1 *before* content. If it fails, drop to radius 3 and add depth via building tiers instead of area |
| **Draft + shop + placement is too much UI for one screen** | Phases are mutually exclusive and full-screen. Never show shop and battlefield decisions simultaneously |
| **Perf collapse once VFX land in M8** | Draw-call/frame-time budget asserted from M0 and checked at every milestone, not at the end |
| **Balance death-spiral** (one dominant build) | Data-driven config + a headless sim harness in Node that runs 1000 seeded runs against scripted build orders and reports win rates |
| **Art scope** | Ship-quality low-poly art for 12 buildings + 7 unit variants + 9 enemies is 2–4 weeks of an artist's time, not included above. Procedural primitives carry the project through M7 |

---

## 11. Immediate next step

M0 + M1: scaffold the project and get a hex grid with a working portrait camera and tap-to-select on screen. That is the cheapest way to validate the riskiest visual assumption (does a radius-4 hex field read on a phone in portrait?) before any gameplay is written.

---

## Appendix A — M1 findings (measured, not estimated)

Built and measured at 375×812 (iPhone-class portrait viewport).

**The portrait framing risk resolved favourably, but with a hard ceiling.**
A radius-4 circular board fits *horizontally* — horizontal extent is the binding
constraint in portrait, exactly as predicted — and at that fit it occupies about
**35% of the viewport height**. The remaining 65% is not recoverable by tuning:

- Camera pitch was raised from 52° to 62°. Because the fit is width-bound,
  steeper tilt projects the board taller at no horizontal cost. Pushing further
  toward top-down yields only ~13% more height in total and flattens the unit
  silhouettes, so 62° is the sweet spot.
- Fit padding was tightened to 1.06; the board now spans ~91% of the width.

**This is a design input, not a defect.** The ceiling means the UI bands are
generous rather than cramped, which is the right trade on mobile. Current split
after biasing the board up-screen (`FRAME_BIAS = 0.42`):

| Band | Share of height | Owner |
|---|---|---|
| Top | ~27% | Wave counter, gold, Eldree HP |
| Board | ~35% | Playfield |
| Bottom | ~41% | Build tray, shop cards, ready button |

The plan's fallback of dropping to radius 3 is **not needed** and should not be
taken — radius 4 fits, and shrinking it would waste screen rather than gain any.

**Other measurements:** 7 draw calls and ~1,600 triangles for the full board
plus Eldree, against a 60-call budget. The whole 61-tile board is one instanced
draw. Headroom for M4's units and VFX is intact.

**One correction to the plan:** fog range cannot be a constant. The camera dolly
distance is a function of viewport aspect and zoom (~52 world units at this
aspect, far outside the originally planned 14–34 band, which made the board
invisible on first run). `Renderer.updateFog` now derives the band from the live
camera distance each frame.

---

## Appendix B — M2 findings

**Draw-call budget is holding with room to spare.** A fully built board — 51
Constructs of all 12 types, every ring unlocked — renders in **15 draw calls**
and ~7,300 triangles. The merged-geometry-per-type approach is why: a building
authored from six primitives still costs one instanced draw, and a type nobody
has built costs nothing because its mesh is created lazily and hidden at zero
count. Merging the Eldree's four canopy blobs the same way took the total from
18 to 15.

**Two placement input paths, not one.** The plan specified drag-and-drop. Built
that, and also kept tap-card-then-tap-tile, because dragging across a 6" screen
one-handed is genuinely awkward and the commit logic is shared — the second path
cost almost nothing. Worth carrying the same dual-path thinking into the M5 shop.

**Touch placement needs a pick offset.** Sampling the target tile at the
fingertip means the finger covers the decision. Placement samples 64px above the
contact point on touch (and 0 on mouse). Verified: a simulated touch drag lands
on the intended tile, not the one under the finger.

**Tile gaps needed a raycast fallback.** Tiles are inset 6% for visual
separation, and the board's edge is a zigzag of pointy tops, so an exact
instanced raycast returns nothing when the ray threads a gap or a notch — which
made the placement ghost blink out mid-drag. Picking now falls back to a
ground-plane intersection rounded to the nearest hex. Measured across a
112-sample sweep of the board: 0 misses, down from a visible flicker rate.

**One correction to the plan.** `RING_UNLOCK_WAVE` treats ring 0 as unlockable
at wave 0, which made the Eldree tile report "locked until wave 0" when tapped.
Ring 0 now has its own placement error. Small, but the class of bug matters: the
Eldree is not an unbuilt tile, it is a distinct entity, and M3 will need that
distinction for targeting anyway.

---

## Appendix C — board now starts at two rings

Locked rings are no longer drawn as darkened tiles inside a pre-built shell.
The board **physically starts at rings 0–2 (19 tiles)** and grows outward as
rings unlock, with the camera easing back to reframe each time.

Why this is more than cosmetic:

- **Tiles read far better early.** The camera fits to board width, so on-screen
  board size is constant regardless of radius — which means a 19-tile board
  gives each hex roughly twice the screen area a 61-tile board did. Constructs
  at wave 1 are legible at a glance instead of being 40px trinkets.
- **Expansion becomes an event.** Ring 3 arriving at wave 4 is now a visible
  moment (new ground appears, camera pulls back) rather than tiles changing
  colour. That reinforces ring unlocking as the progression curve.
- **Draw calls at wave 1 dropped to 3** (board + trunk + canopy), from 6.

Implementation notes:

- `HexGridView` only instances unlocked cells, so **instance index no longer
  equals cell index**. `instanceToCell` carries the mapping for picking; this is
  the main regression risk and is covered by locating placed Constructs by tap
  after two board rebuilds.
- The ground-plane pick fallback rounds to the nearest hex, which can land on a
  ring that does not exist yet — those now return null rather than a phantom tile.
- `CameraRig.fitBoard(radius, animate)` eases distance and framing bias; pinch
  zoom stays instant, since easing a live gesture reads as lag.

---

## Appendix D — Constructs are fitted to the tile, not hand-sized

Buildings were authored at whatever size the primitives happened to produce, and
sat at roughly 40–55% of their hex — the Palisade in particular read as a twig
rather than a wall.

`MeshKit.fitToTile` now measures each merged geometry and scales it so its
footprint spans **94% of the tile's inscribed circle**. Two decisions worth
recording:

- **The inscribed circle is the right bound, not the hex outline.** Constructs
  are yawed to face outward, so the footprint rotates within the tile; the
  largest circle that fits is the only bound that holds at every angle.
- **Height is damped, not carried along.** A slender Construct needs a large
  factor to fill its hex, and applying it uniformly would make the Mage Spire
  ~2.8 units tall — enough to hide the tiles behind it on a 62 degree camera.
  Vertical scale takes 40% of the horizontal factor, which lands the range at
  0.67 (Ballista) to 1.95 (Mage Spire): low turrets, tall spires, readable board.

Fitting is measured rather than authored so it cannot drift when a shape is
edited, and it runs once per type at first placement, not per Construct.

| Construct | Height | | Construct | Height |
|---|---|---|---|---|
| Ballista | 0.67 | | Bastion Keep | 1.27 |
| Archery Range | 0.75 | | Arcane Obelisk | 1.83 |
| Palisade / Rune Ward / Shrine | 0.88 | | Bowspire | 1.85 |
| Knight's Hall | 0.89 | | Mage Spire | 1.95 |
| Barracks / War Lodge | ~1.0 | | | |

---

## Appendix E — M3 findings

**The headless-sim rule paid for itself immediately.** `src/sim/` imports
nothing from three, which meant the whole milestone could be verified by driving
the simulation directly instead of watching it: 900 fixed steps in a loop,
asserting on the result. That caught behaviour a renderer would have hidden and
made every claim below a measurement rather than an impression.

Verified this way:

| Property | Result |
|---|---|
| Determinism | Same seed twice → byte-identical entity fingerprint; different seed → differs |
| Defeat path | Wave 1 (5 Orcs) first strikes at 5.2s, Eldree falls at 9.8s |
| Clear path | Smite → phase Cleared, gold paid, wave advances, next wave starts clean |
| No wall-in exploit | Ring 1 fully walled → all 12 ring-2 tiles still routable (cost 8 vs 2) |
| Detour | Partial wall → path routes around it, never through |
| Flying | 3/3 Wraiths head straight at the core with routing walled off |
| Crowding | 30 live bodies → 5 slight overlaps, tightest at 93% of contact distance |
| Throughput | Wave 10, 40 foes, resolves in 12.2s |

**Buildings cost path, they do not block it.** `BUILDING_COST = 6` — about six
open tiles' worth of detour. High enough that the horde routes around a defended
line when one exists, finite so it can never be sealed. Making Constructs
impassable would turn the game into maze-building and let one ring of Palisades
stall a wave indefinitely.

**Separation is position correction, not steering force.** One relaxation pass
per tick, iterated in id order so it stays deterministic. It is stable at 30 Hz
with no tuning, where a force-based approach would need damping to stop the
horde oscillating once it funnels at the Eldree.

**Enemy meshes are fitted to their collision radius**, the same measured-fit
approach Constructs use. Body size is therefore tuned in `enemies.ts` next to
speed and health, and a model can never drift from the space it occupies — which
would show as bodies visibly overlapping, or standing apart for no reason, once
a horde packs in.

**M3 is deliberately unwinnable.** Nothing shoots back until M4, so a wave can
only be survived via the `Smite` dev button. That button exists to exercise the
death, reward and wave-clear paths that combat will drive for real.

---

## Appendix F — M4 findings

**A real targeting bug, caught only because the sim is headless.** Ranged
units' acquisition radius was wired to `leash` instead of weapon `range`.
Leash for Archers/Mages is deliberately tiny (0.9 units) so they don't wander
from their post — but that also meant they could only *see* a target within
0.9 units of their station, even though they could *hit* anything within their
real 2.7-3.4 unit range. Anything that stopped just outside leash but inside
range sat unengaged indefinitely.

Symptom: a defended board still lost on wave 3, with a Troll parked 2.5 units
out taking zero damage for 24 straight seconds before finally reaching the
Eldree. Root cause was found by tracing `targetId` and `hp` per tick rather
than watching the render — the stall was invisible-by-eye at board zoom but
obvious as a flat line in the trace.

Fix: acquisition radius is now `range` for ranged units, `range + leash` for
melee (which still need to walk into strike distance).
[`unitEngageRadius`](../src/sim/Sim.ts) is now the single place this is computed.

Verified after the fix: a perimeter with one Construct per bearing (Knight,
two Archery Ranges, a Mage Spire) cleared **waves 1 through 6 cleanly** — every
enemy killed, Eldree at full health each time — including wave 5 (introduces
Wraiths, confirming magic damage actually resolves) and wave 6 (all three
enemy types across 4 arcs at once).

**Targets are sticky, not re-acquired every tick.** An entity keeps its current
target while it stays alive and in reach. Re-running nearest-neighbour every
tick makes units flicker between two equidistant foes and finish neither —
this is the second half of what "not mush" requires, alongside the leashed
stationing from M3's movement design.

**The leash is still measured from station, now for search too.** Both
targeting and movement anchor to the unit's formation slot, not its current
position. This is the fix from M3's blob risk, and it had to be threaded
through combat too or a unit could be pulled arbitrarily far by a chain of
barely-in-range targets.

**One relaxation detail that mattered for readability, not correctness:**
Constructs push units and enemies but are never pushed themselves. Without
that a body could shove a building's collision circle and visibly nudge a
tile's occupant, which reads as broken even though nothing is functionally wrong.

**Health shows as silhouette tint, not a floating bar.** A bar per body across
20+ concurrent actors would cost more draw calls than the rest of the scene.
Full-health actors are left untinted, so any colour shift on the board means
something is actually hurt — cheap, and legible at board zoom.

**Verified paths, all via direct sim driving (`window.game` in dev builds):**

| Path | Result |
|---|---|
| Garrison muster | Barracks reaches roster cap (3) in ~21s, matches spawn interval |
| Wave clear, defended | 6 consecutive waves, 100% kills, Eldree undamaged |
| Wave clear, mixed enemies | Wraiths (magic-resistant) die to Mage splash; confirmed wave 5 |
| Move | Garrison re-stations at the new tile, does not respawn or vanish |
| Sell | Building and its whole garrison removed from the sim in the same tick |
| Construct destroyed by the horde | `onConstructDestroyed` fires, registry and tile clear correctly |
| Dev-handle strip | `Object.assign(window`, `restartRun`, `game:{` all absent from the prod bundle |

---

## Appendix G — M5 findings

**Kept Placement's pay-at-commit contract instead of paying at shop purchase.**
The obvious design is "spend gold when you click Buy in the shop." That
requires the placement step to be un-cancellable — if a mistap could silently
lose an already-paid Construct, that's real player harm. Keeping the existing,
tested Placement contract (cost is spent only on a successful tile commit)
sidesteps the whole problem: buying a card just arms the same drag-or-tap
placement the tray always used, and backing out costs nothing because nothing
was ever charged. This meant the entire Placement/GhostView/tap-vs-drag stack
from M2 needed zero changes — only what *arms* it changed, from a persistent
tray to the Shop's Buy button.

**Two real bugs, both found by driving the UI rather than trusting it:**

1. `ShopPanel.syncGold` checked `rerollBtn.dataset['cost']`, but `show()` never
   set that attribute — so the reroll button's affordability check always
   compared against 0 and could never disable. Draining gold to 5 with a
   10g reroll cost should have disabled the button; it didn't, until the
   dataset write was added. Caught by directly inspecting the DOM attribute
   the check depended on, not by reading the visual state.
2. `restartRun()` reset the board, the sim and the wave counter, but not
   `Economy` — a defeated run's leftover gold carried into the next attempt.
   In a roguelike-framed loop where each run is supposed to start from the
   same baseline, that's a real progression leak. Caught by granting gold,
   forcing a restart, and asserting the balance returned to the starting 400
   rather than assuming it did.

**A stale-render trap, twice.** Testing pointer interactions with `.click()`
instead of real `pointerdown`/`pointerup` silently does nothing, because the
Shop and (formerly) the tray both use press/drag/tap disambiguation on
`pointerdown`, not a `click` listener — a synthetic click never fires it. And
the browser pane throttles `requestAnimationFrame` while hidden, so
`syncReadyButton()` (which only runs inside `render()`) reports stale text
until the tab is fronted and a real frame runs. Both produced results that
looked like bugs and weren't; the fix both times was the same — front the tab,
let a real frame land, then re-read the DOM.

**A "built" count plateau that also wasn't a bug.** A regression sweep across
6 waves showed the registry's building count occasionally failing to increase
even though gold was visibly spent each wave. Not a lost purchase: a
defenseless Construct (Healing Shrine, no weapon) placed directly in the
horde's path got ground down and destroyed by enemies pausing to attack it
mid-transit — exactly the M3/M4 "buildings cost path, don't block it" and
"enemies can target Constructs" behaviour working as designed. Confirmed by
checking Eldree health stayed untouched every wave; the horde spent itself on
the shrine instead of reaching the tree.

**Verified paths:**

| Path | Result |
|---|---|
| Cold boot | Shop opens for wave 1 with no prior wave fought |
| Buy → place → ready → fight → clear → shop | Full cycle, verified via real pointer events through a live frame |
| Reroll | Gold -10 (then -15 next use), offer changes, cost escalates |
| Skip | Gold +15, shop closes, board returns to Prep |
| Read-only inspect mid-wave | Move/Sell hidden, Close only, live HP shown |
| Defeat → restart | Board cleared, wave reset to 1, Eldree healed, **gold reset**, shop reopens |
| 6-wave regression, rotating placement bearing | All 6 cleared, reactive wiring (shop→registry→sim→economy→shop) held throughout |
| Dev-handle strip | `Object.assign(window`, `restartRun`, `game:{` all absent from the prod bundle |

---

## Appendix H — shop revised: buy every slot, not just one

Changed on request: the shop no longer closes after a single purchase. A
visit now stays open across as many of the 3 offered slots as the player can
afford, with Reroll available throughout.

**The correctness trap this created, and how it was avoided.** The naive
version marks a slot "bought" the instant its Build button is tapped. But
Placement is pay-at-commit (Appendix G) — cancelling a placement is free and
common (a mistap, a deliberate change of mind). If the slot is marked bought
at tap-time, a cancelled placement leaves a slot permanently flagged "✓ Built"
with nothing actually on the board, silently costing the player that build
option for the rest of the visit. Caught before it shipped by testing the
cancel path specifically (Escape mid-placement) rather than only the happy
path — the fix was a new `Placement.onPlaced` callback that fires from inside
`commit()`'s success branch, distinct from `onChange`'s return to `idle` (which
fires on cancellation too). The shop only marks a slot bought when
`onPlaced` actually fires.

**State ownership split between two "still deciding" signals.** `shop.isOpen`
now spans the whole visit, including the hidden-panel interval while a single
purchase is mid-placement. `placement.isActive` covers just that interval.
The Ready button's label logic has to check `placement.isActive` before
`shop.isOpen` — otherwise it reads "Resolve the shop" while the board and
ghost preview are visibly what's on screen, because the panel being hidden
doesn't mean the *session* ended.

**Skip vs. Continue is not the same action reused.** Once a purchase has
happened, refunding 15g for "skipping" the rest of the offer no longer makes
sense — the player already got value from the visit. The footer button
relabels based on `Shop.anyBought`: "Skip · +15g" before any purchase,
"Continue" (no gold change) after.

Verified: buy-cancel-retry leaves the slot buyable and unmarked; a full
4-wave run buying every affordable slot each visit (up to 3 Constructs per
wave) held eldreeHp untouched throughout; reroll clears all "Built" marks on a
fresh draw.

---

## Appendix I — persistent bottom shop, top-only enemy approach

Two requested layout changes, implemented together since both affect how the
board reads at a glance.

**Shop moved from a blocking modal to a persistent bottom dock.** M5's shop
was a full-screen overlay, deliberately, to satisfy the plan's own risk note
("never show shop and battlefield decisions simultaneously"). That guidance is
now superseded: the shop (`ShopDock`) sits pinned at the bottom of the screen
for the whole Prep period, always showing exactly 3 cards, with the board
visible and never obscured. This is actually a better fit for "drag the
Construct onto an available hex" — a full-screen shop was working against the
very interaction it was meant to enable, since the board wasn't visible to
drag onto while the shop was open. `Shop` lost `isOpen`/`skip()`/`finish()`
entirely: there's nothing to open or close, only a wave in progress (dock
hidden) or not (dock shown). Verified: buying, placing, and rerolling all
still work through the dock exactly as the modal's multi-buy mechanic did
(Appendix H), confirmed via a 4-wave regression sweep.

**Enemies now always approach from the top of the board.** Previously waves
spawned across `arcs` compass directions (up to 6, surrounding the board).
`WaveDef.arcs` is renamed `lanes` and reinterpreted: lanes are still evenly
spaced and still the wave's pressure dial, but always within a ~130° band
centred on the world angle that projects to the top of the screen, never
wrapping to the sides or bottom.

Before writing the spawn math, the world-to-screen direction was verified
empirically rather than assumed from the camera setup code: projected two
world points (+Z and -Z) through the camera's live `matrixWorldInverse` /
`projectionMatrix` and compared clip-space Y. -Z was confirmed to render at
the top. Getting this backwards would have put the entire Shadow Army at the
bottom of the screen, behind the shop dock, which is exactly the failure mode
worth a five-minute check to avoid.

**Two false alarms while verifying, both render-loop timing, not sim bugs.**
Manually stepping `sim.update()` in a script while the tab is fronted races
the app's own live game loop, which is also calling `sim.update()` every
frame — double-stepping combat and making a wave resolve far faster than it
should. And synchronously changing state then immediately calling `.click()`
on a button races `syncReadyButton()`, which only runs inside `render()`; a
disabled `<button>` doesn't dispatch `click` at all (matching real touch
behaviour — a visually disabled button can't be tapped either), so the
click silently no-ops if no render frame has landed yet to lift the
`disabled` attribute. Both resolved by pausing the loop (`loop.paused = true`)
before manual stepping, or calling the underlying function (`game.startWave()`)
directly instead of racing the DOM.
