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

---

## Appendix J — merging Constructs into their tier-2 upgrade

Added on request: two matching Constructs combine into the family's tier-2
building. The four spawner pairs (Barracks/War Lodge, Archery Range/Bowspire,
Knight's Hall/Bastion Keep, Mage Spire/Arcane Obelisk) already existed as
separate tier-1/tier-2 `BuildingId`s from M2 — merging only needed an explicit
`upgradesTo` link between them, not new content.

**Reused the Placement state machine rather than building a parallel one.**
`PlacementState` gained a fourth variant, `'merging'`, alongside
`placing`/`moving`/`idle`. This bought the whole cancel/tap/toast contract for
free — a merge in progress is armed, cancellable (Escape or tapping empty
ground), and forgiving of mistaps (an on-board tap that doesn't match stays
armed with an error, exactly like an invalid placement does) — without writing
any of that machinery a second time. The mechanical merge itself is three
calls to already-tested `BuildingRegistry` methods: `remove(source)`,
`remove(target)`, `place(upgradeId, targetCell)` — no new registry or sim
primitives.

**Merge is tap-only, deliberately, for the same reason Move already is.**
M2's Move never supported dragging an existing Construct because a
board-originated drag races the camera-pan gesture (documented on
`InspectPanel` from the start). Merge inherits that constraint outright:
tap a Construct, tap Merge, tap a highlighted partner.

**Eligible targets get their own highlight, because Placement's existing
preview can't fire for a tap-only interaction.** The ghost/marker preview in
`Placement.preview()` only runs from `trackPointer()`, which only fires during
an active drag — irrelevant here. `MergeHighlight` is a small pooled set of
`TileMarker`s shown all at once the instant merge mode arms, computed by
`registry.ofType(source.def.id)` filtered against the source's own id. This
also fixes the discoverability problem a single hover marker would have had:
the player sees every valid option immediately, not just whichever tile they
happen to be touching.

**Free, not discounted.** Two tier-1s cost more in total than merging saves
on the eventual tier-2 (the discount ranges from 20% for Barracks down to 0%
for Mage Spire, an artifact of prices set before merge existed) — rebalancing
all eight prices to a consistent discount was judged out of scope for this
ask. Merging costs nothing beyond what was already spent on the two
tier-1s, matching the mobile-merge-game mental model of "combine what you
have" rather than introducing a new toll.

**One real methodology trap while verifying, caught before it became a false
bug report.** A before/after test comparing live units by `ownerId === simId`
showed apparent "orphaned" units surviving a merge — alarming, until checking
whether `World`'s id free-list had reused the just-freed `simId` for the
merged Construct itself (it had: `merged.simId === b.simId`), so the "leak"
was the merged Construct's own legitimate new unit matching a stale id
comparison, not a leftover from the old one. Isolating a single
`registry.remove()` and checking the exact same entity id before/after (no
second Construct in play to trigger recycling) confirmed teardown is clean:
the owned unit dies in the same call that removes its Construct.

Verified: highlight shows exactly the eligible partner(s), excluding the
source and any non-upgradeable defensive structures; self-tap and mismatched
taps stay armed with an error; Escape/off-board cancels with no state
change; a successful merge is free, removes both sources, and the resulting
Construct's garrison musters correctly; Merge is hidden whenever Move/Sell
are (mid-combat, or no `upgradesTo`, or no eligible partner on the board).

---

## Appendix K — first spawn now waits a full cooldown

`addConstruct` set a freshly placed Construct's spawn timer to 35% of its
interval, so the first unit arrived well before a normal cooldown cycle would
allow — a deliberate M4 choice ("garrisons quickly but not instantly") that no
longer holds. Changed to the full `def.spawn.interval`, matching every spawn
after it. `spawnerStep` already resets to the full interval post-spawn, so
this was the only preferential case in the codebase.

Verified per-building: Barracks (6s) held at garrison=0 through t=6s, spawned
between t=6–7s; Archery Range (7s), Knight's Hall (10s), and Mage Spire (9s)
each matched their exact interval when checked at t=9.5s (spawned iff
interval ≤ 9.5s). No change needed to merge, since merged Constructs are
created through the same `addConstruct` path.

---

## Appendix L — cooldown bars above every Construct

A charge-up bar over each Construct with a timer — spawn interval for
spawners, attack cooldown for turrets — filling from empty (just spawned/shot)
to full (ready again).

**Reconciling with the M4 decision to skip per-unit health bars.** The
project deliberately avoided a floating health bar per unit body (hurt-tint
covers that instead, cheap and legible at board zoom, README/PLAN already
document why). This is a different case, not a reversal of that call: it's
capped at Construct count (≤61) rather than the hundreds of units/enemies the
original decision was about, and it shows information — cooldown timing —
that has *no* existing visual representation at all, where health already
does via tint. Both the scale and the information gap are different from what
was ruled out.

**Fixed camera, so no per-frame billboard math.** Because CameraRig's pitch
never changes at runtime, "face the camera" is a single rotation baked into
the bar geometry once at construction (`Euler(-PITCH, 0, 0)`), not a per-frame
lookAt. `PITCH` is now exported from `CameraRig` rather than redefined locally
— a duplicated copy would silently drift if the angle is ever retuned, and
nothing would catch it since the failure mode is "bars point the wrong way",
not a type error.

**Fill grows from a fixed edge via a pivot trick, not per-frame repositioning.**
The fill quad's geometry is translated so its local origin sits at its own
left edge (`fillGeo.translate(BAR_WIDTH / 2, 0, 0)`); scaling `scale.x` by
`progress` then grows it rightward from that fixed point for free, needing
only a one-time position offset (`-BAR_WIDTH/2` from the bar's anchor) rather
than recomputing position every frame to keep the left edge pinned as it grows.

**Height is measured, not hand-tuned, and this caught its own bug during
verification.** First pass used one fixed Y-offset (2.15) clearing the
tallest Construct (Mage Spire, ~1.95) — correct for tall buildings, but it
left short ones (Ballista, ~0.67) with their bar floating visibly disconnected
above them, reading as "belongs to the Eldree" rather than "belongs to this
turret" in a screenshot. Fixed by adding `buildingHeight()` — reads the
already-fitted geometry's bounding box (`computeBoundingBox().max.y`), cached
per type — so each bar sits a fixed small margin above its *own* building's
actual roofline. Reusing the geometry as the source of truth, the same
approach `fitToTile` already uses, means the bar can never drift out of sync
with a shape that gets retuned later, unlike a hand-authored height table
would.

**The spawn-timing fix from the previous request made this feature's numbers
honest.** Cooldown bars would have been showing progress against a lie if the
first-spawn 35%-head-start bug (Appendix K) were still in place — the bar
would read "nearly full" moments after a Construct was raised, not matching
when the unit actually arrived. Fixing the timing bug first meant the bar
didn't need any compensating logic of its own.

Verified: bars sit correctly above their own building at both close and
board-wide zoom; draw calls are a flat +2 regardless of Construct count (8
total with 3 buildings, 17 total at 60 — full board capacity, one under the
61-instance pool); a fully-idle turret with no target shows full (matches
`attackStep`'s actual behaviour — cooldown ticks down even without a target,
so it sits "ready" while idle, which is correct, not a bug); Palisade and
Healing Shrine (no `spawn`, no `weapon`) correctly show no bar at all.

---

## Appendix M — camera reframed: bottom-anchored board, top approach visible

Requested directly: zoom out, and move the board down-screen so the top band
— where the horde always enters, since the top-lanes change — has room to
actually show the approach, not just the moment enemies reach the board edge.

**`FRAME_BIAS` flipped, not just retuned.** It was `+0.42`, pushing the board
*up*-screen to leave room for the old full-screen shop's bottom band. Since
that shop is now a compact persistent dock (this session, earlier), the
bottom no longer needs nearly that much room — freeing it to flip the other
way. Now `-0.6`, pushing the board *down* so the top gets the space instead.

**"Zoom out" needed a second change beyond the bias, or spawns would still be
invisible.** `fitBoard()` only ever sized the camera to the board's own
radius — comfortable margin for the board itself, but enemies spawn
`SPAWN_MARGIN` (2.2 world units, plus jitter) *beyond* that edge, meaning a
freshly spawned enemy was very likely fully outside the frustum regardless of
which way the board was biased. Added `APPROACH_VISIBILITY = 3.4`, folded
into the fit-distance calculation only (not into `this.boardRadius` itself,
which fog and the pan limit still key off) — so the frustum now comfortably
contains the spawn ring, not just the board.

**Verified two different things, not just "it looks right":** a full NDC
projection check confirmed every live enemy stayed within `[-1, 1]` on both
axes from the instant it spawned (0.5s into a 6-lane wave through 2s in, 4
enemies checked, zero off-screen) — this is the actual claim "visible from
the top" makes, not just a visual impression from one screenshot. Separately,
confirmed the board's own expansion (`visibleRing`/`visibleCells`/
`visibleWorldRadius`) and tile-tap placement both still resolve correctly at
the new, wider framing — the camera math changed, not the picking or grid
logic, but both were re-verified rather than assumed unaffected.

---

## Appendix N — merge, corrected: drag a purchase onto an existing building

The Appendix J merge (tap a built Construct, tap Merge, tap a matching
partner) wasn't what was actually wanted. The real ask: drag a shop card
straight onto a matching Construct already on the board, merging them in one
motion — no need to have two already placed first. Both mechanics are kept,
since they serve genuinely different situations (see README), but this is
now the headline path.

**Occupied-but-matching had to become a third outcome, not a shade of
"valid".** `Placement.check()` previously had exactly two outcomes for a
purchase drop: empty tile (buildable) or occupied (rejected). A tile occupied
by a *matching, upgradeable* Construct is now a third case — valid, but not a
fresh placement. `GhostView.show()`'s boolean `valid` became a `'valid' |
'invalid' | 'merge'` union, with the ghost showing the *upgrade's* geometry
during a merge preview, not the card being dragged — the player sees what
they're about to get, not what they're holding. Getting this preview right
mattered as much as the mechanic itself: without it, a valid merge drop would
have shown the same red "occupied" tint as a real failure, actively telling
the player the correct action was wrong.

**A real ordering bug caught before it shipped, not after.** First pass
detected the merge target and dispatched straight to `commitPurchaseMerge()`
*before* running it through the shared `check()`/error-handling block — which
meant the "stay armed so a tap mistap doesn't cost you anything" forgiveness
every other path gets was silently skipped for merges specifically. An
unaffordable merge attempt from a *tap* would cancel outright instead of
staying armed like an unaffordable normal placement does. Caught by testing
the exact failure case (drain gold mid-arm, then tap) rather than only the
happy path — moving the merge dispatch to *after* `check()` (which already
had the merge-target affordability rule folded in) fixed it: `check()` now
gates uniformly for both outcomes, and only a confirmed-OK drop branches into
either the merge or the normal build.

**Cost model, confirmed consistent with the free tap-merge.** Buying card
into an existing Construct costs exactly the card's standalone price — e.g.
two Barracks via this path costs 60g (existing, paid earlier) + 60g (new
card) = 120g total, identical to the tap-merge path's total spend for the
same outcome. The mechanics differ in *when* you commit to merging, not in
what it costs.

Verified: drag-drop and tap-drop onto a match both merge correctly; ghost
shows violet + the tier-2 shape while hovering a valid target; a mismatched
type and a same-type-no-upgrade target (Palisade) both still reject normally
as "occupied"; unaffordable-via-tap now correctly stays armed, unaffordable-
via-drag still cancels (matching the pre-existing asymmetry the rest of the
class already has); the original tap-select-two-existing-buildings path is
unaffected and still free.

---

## Appendix O — merge was silently wiping the garrison it should have upgraded

Reported directly: after a merge, the units reset. Confirmed by direct
measurement before touching any code — two fully-mustered Barracks (6
Warriors total) merged into a War Lodge came out with a garrison of **0**,
forced to muster its entire roster from scratch. A merge framed as an
upgrade was, mechanically, strictly worse than doing nothing for the next
~20 seconds.

**Root cause was architectural, not a one-line typo.** Both merge paths
built the upgrade out of the same two primitives every other placement uses:
`registry.remove(x)` then `registry.place(upgradeId, cell)`. Those fire
`onRemoved`/`onPlaced`, which the registry↔sim wiring in `main.ts` maps to
`sim.removeConstruct()` (which **always** kills the garrison — correct for a
sale, wrong for a merge) and `sim.addConstruct()` (which **always** starts a
roster at zero). Reusing generic primitives for a specific transition lost
the information that this removal-and-placement pair was actually one
event, not two independent ones.

**Fix threads a merge through as a single event, end to end.** Added
`BuildingRegistry.merge(sources, upgradeId, cell)` — same tile/map
bookkeeping as `remove`+`place`, but firing a new `onMerged(sources, result)`
hook instead of the generic pair. `main.ts` wires that hook to a new
`Sim.mergeConstructs(sourceSimIds, upgradeDef, cell)`, which snapshots every
surviving unit owned by *either* source before tearing the Construct entities
down (not their garrisons), then re-homes as many as the new roster holds
onto the upgrade — reusing `writeStation` so transferred units re-station
around the *new* Construct's position rather than staying pinned to
wherever the old one stood. Anything beyond the new cap is released, since
there is no slot left to hold it.

**One method serves both merge paths**, not two near-duplicates: passing a
one-element `sourceSimIds` array (the drag-a-purchase-onto-an-existing-
Construct path, where the "new half" never existed as a live entity to have
a garrison of its own) and a two-element array (the free tap-two-existing-
Constructs path) both flow through the same transfer logic.

Verified: 2 Barracks (6 Warriors) → War Lodge (cap 5) carries exactly 5,
releases 1; 2 Knight's Halls (2 total) → Bastion Keep (cap 2) and 2 Mage
Spires (2 total) → Arcane Obelisk (cap 2) are both exact fits, losing none;
the drag-purchase path correctly carries an existing Construct's garrison
into the upgrade too; a normal **sell** (not a merge) still fully releases
its garrison, confirming `removeConstruct`'s ordinary behaviour is
untouched; transferred units visually re-station in formation around the
new Construct rather than clumping at the old position; the mismatched-type
and same-type-no-upgrade rejection cases from Appendix N still hold.

---

## Appendix P — merging by dragging one board building onto another

The third and final merge trigger requested: pick up an already-placed
Construct and drag it onto another one, directly on the board. This is
exactly the gesture M2's Move deliberately avoided — "a drag starting on the
board would race the camera pan gesture" — so making it work meant solving
that conflict properly rather than reopening the old trade-off blind.

**Hold-delay disambiguation, not a new gesture zone.** A quick drag starting
anywhere on the board, including directly on a built tile, still pans the
camera exactly as before — that path is completely unchanged. Only a press
that stays within `TAP_SLOP` for `LONG_PRESS_MS` (380ms) on a tile
`InputController` is told is a merge candidate becomes a pickup; panning is
suppressed only for that brief wait, and only on tiles flagged as candidates
(a Construct with an upgrade and an existing match — the same rule the other
two merge paths already use), not the whole board. Getting this wrong in
either direction would have broken something real: too eager, and normal
panning from a built tile stutters or hijacks; too conservative, and the
pickup never fires.

**The mechanic itself needed zero new code.** `Placement.beginMerge()` and
`commitMerge()` already existed from the InspectPanel path (Appendix J) and
already carry the garrison-preserving fix (Appendix O) — this only needed a
new *trigger*. `beginMerge()` gained a `dragging` flag so a failed drop
cancels outright instead of silently staying armed (the finger has already
lifted; there is nothing left to stay armed *for*), matching how every other
drag in the class already behaves. `InputController` gained the hold-timer
and four callbacks (`onBuildingDragCandidate/Start/Move/End`); `main.ts`
wires them to the exact same `beginMerge`/`tapAt` calls the InspectPanel
button already used.

**A test-harness trap, not a real bug, cost the most time here.** The first
attempt at verifying this reported total failure — long-press never armed,
state stayed idle no matter how long the wait. `canvas.setPointerCapture()`
was the culprit, but not in the product code: it throws `NotFoundError` for
a synthetic `PointerEvent` whose `pointerId` was never associated with a
real active pointer session, and `onPointerDown` calls it as its first line,
aborting the whole handler silently before the hold timer was ever armed.
Pointer id `1` — this session's persistent virtual mouse pointer — works;
any other id doesn't. Confirmed directly (`canvas.setPointerCapture(1)`
succeeds, `setPointerCapture(7)` throws) before concluding anything about
the feature itself, and every earlier test this session had used id `1`
already, which is exactly why they'd all passed.

Verified: long-press-then-drag onto a match merges for free, garrison
carried over; a quick drag from the same tile still pans (camera target
confirmed moved, no state change); dropping on a mismatched building or off
the board both cancel outright (not stay-armed, matching the new `dragging`
flag); a lone Construct with no match never arms the pickup at all; the
violet highlight lights only the eligible target, never the source being
dragged; picking up is refused outright during a running wave, matching
Move/Sell/the other merge paths; ordinary quick-tap selection is unaffected.

---

## Appendix Q — reverted to omnidirectional attacks

On reflection, requested back: the Eldree stays at the board's centre (always
was), but the Shadow Army should attack from every side again, not just the
top. This walks back the top-lanes change from a few turns ago toward the
original concept ("Hordes of the Shadow Army attack from all sides").

**The spawn-angle change was a clean revert.** `Sim.spawnEnemy` drops the
`TOP_ANGLE`/`APPROACH_WIDTH` band entirely and goes back to distributing
`lanes` evenly around the full circle (`(lane / lanes) * 2π + jitter`) — the
exact formula from before the top-only change, just kept under the `lanes`
naming rather than reverting that too, since "how many arrival directions"
reads the same either way.

**The camera framing needed real tuning, not just an undo.** Reverting
`FRAME_BIAS` to its old +0.42 would have been wrong — that value was sized
for the old full-screen shop's much bigger bottom band, which no longer
exists (the shop is a compact dock now). Landed on a small +0.16: enough to
acknowledge the dock still occupies some bottom space, without meaningfully
favouring one direction now that the horde has no "front" to favour.
`APPROACH_VISIBILITY` dropped from 3.4 to 2.4 for the same reason the old
value doesn't apply anymore — it was sized to guarantee full visibility of
one specific band, which is no longer the goal; a smaller general margin
just keeps nearby spawns from popping in from a fully-cropped edge.

**One trade-off is now inherent, not a bug to chase:** a portrait phone
screen cannot show a full 360° spawn ring at once at a legible zoom level.
Some spawns, in whichever direction the player isn't currently looking, will
be off-screen until they close some distance — this is the accepted cost of
"attacks from everywhere" over "attacks from one legible direction," and
matches how most 360°-threat tower-defense games actually play (peripheral
awareness and the wave-progress HUD substitute for full visibility).

Verified: enemies confirmed spawning from multiple directions in the same
wave (top and bottom both visible in a single screenshot, 6-lane wave); the
board reads centred rather than pinned to one edge at both close and
board-wide zoom; typecheck, build, and dev-handle stripping all clean.

---

## Appendix R — the button-triggered merge is gone; drag-only now

Reported directly: the InspectPanel's tap-select-then-tap-Merge-button flow
still felt clunky, and the ask was explicit — drag and drop, not a button.

**Removed, not replaced.** The button offered exactly one thing: the free
"combine two Constructs you already own" action. The board-to-board
long-press-drag (Appendix P) already *is* that same action, just triggered
by dragging instead of tapping a button — so removing `InspectPanel`'s
Merge button loses no capability, it only removes the worse of two paths to
an identical outcome. `Placement.beginMerge()`/`commitMerge()` are untouched
internally; only the trigger (the button, and the `inspect.onMerge` wiring
in `main.ts`) is gone. The `dragging` flag on `beginMerge()` stays even
though every remaining caller passes `true` — it is a real, load-bearing
distinction (stay-armed-on-invalid-drop for a tap vs. cancel-outright for a
drag, since a drag's finger has already lifted), not vestigial flexibility,
and cheap enough to keep for whatever the next merge trigger turns out to be.

Also swept up: the `.inspect-actions .merge` CSS rule and the `--merge` CSS
custom property it was the only consumer of, both dead once the button's
markup was gone.

Merging is now exactly two drag gestures — drop a shop purchase onto a
match, or long-press-drag one owned Construct onto another — and nothing
else. Verified both still work end to end after the button's removal: the
InspectPanel's action row is back to Move/Sell/Close (no third button); a
board-to-board drag merge still produces the upgrade for free; a shop-card
drag onto an existing Construct still merges for the card's price.

## Appendix S — Move and Sell unified into the same drag; InspectPanel goes read-only

Reported directly: tapping a board Construct still surfaced a Move/Sell
button menu, and the ask was to make those drag-and-drop too, selling by
dropping on a new recycle icon. With the merge button already gone
(Appendix R), this was the last button-driven action left on the board.

**One state, three outcomes.** `Placement`'s `'merging'` state is deleted
outright — `beginMerge()`/`commitMerge()` are gone, and `beginMove()` is now
the single entry point for Move, Merge *and* Sell alike, disambiguated
purely by where the lifted Construct lands: an empty tile moves it, a
matching Construct merges into it (`commitMoveMerge()`, the free
board-to-board counterpart to the shop's `commitPurchaseMerge()`), and a new
recycle-zone drop zone sells it (`sellDragged()`). This is a genuine
simplification, not just a rename — `'merging'` had exactly one trigger
(the board long-press-drag from Appendix P), and once Move's own commit path
learned to check `mergeTargetAt()` first, that trigger's whole reason to be
its own state disappeared. `check()` and `preview()` gained the matching
`'moving'`-branch merge lookups, so the ghost/marker preview shows the
tier-2 result (violet) while dragging over a match, exactly like a shop-card
drag already did.

**InputController's gate widened.** `onBuildingDragCandidate` used to allow
picking up only a mergeable Construct (had `upgradesTo`, and a second of its
kind existed); now it is `!!registry.at(cell)` — any placed Construct,
combat-phase-gated as before. `onBuildingDragMove`/`onBuildingDragEnd` grew
new parameters: the move callback now also passes the touch-offset-adjusted
board cell under the finger (so `Placement.previewAt()` can drive the live
ghost during a board drag the way `trackPointer()` already did for a
shop-card drag — the long-press path never ran through `trackPointer`, so
without this the merge/move preview would only have shown up front via
`MergeHighlight`, never following the current hover), and the end callback
now also passes the *raw*, non-offset release point for hit-testing DOM drop
zones — the recycle icon is a real element the finger is aimed at, not a
board tile that wants the "clear the fingertip" adjustment.

**RecycleZone** (`src/ui/RecycleZone.ts`) is a new DOM overlay, shown only
while a board Construct is mid-drag. It covers the shop dock's own screen
area rather than floating as a small separate icon — nothing in the dock is
reachable mid-drag anyway, so replacing it reads clearer than competing for
space next to it. Hit-testing is a plain `getBoundingClientRect()` check
(`contains(x, y)`), not the 3D `pick()` used for board tiles, since this
lives in screen space. It also toggles an `armed` state as the drag hovers
it, for feedback before release.

**InspectPanel lost its action row entirely** — no Move, Sell, or even
Close button now, just name + blurb (+ live HP mid-combat). A tap always
shows this read-only card; picking the Construct up for Move/Merge/Sell is
long-press-drag only, matching how merge-only used to work before this
change extended it to every Construct. Dismissal is tap-elsewhere, same as
before Close existed.

Verified end to end in the browser via synthetic pointer events (long-press
threshold, then move, then release): dragging one Barracks onto another
still merges for free with the garrison carried across; dragging a Construct
onto an empty tile still moves it for free; dragging a Construct onto the
recycle zone sells it for the standard 60% refund and the zone visibly arms
on hover; a plain tap still shows the read-only info card with no buttons.

---

## Appendix T — a third merge tier for every spawner family

Requested directly: merging should go further than tier 2. Each of the four
spawner families gained a tier-3 Construct — Warhost Bastion, Stormwatch
Spire, Highguard Citadel, Eldree Sanctum — reached the same way tier 2 is,
by merging a matching pair of tier-2s.

**Nothing about the merge mechanism itself changed.** `Placement`,
`BuildingRegistry.merge`, and `MergeHighlight` all key off a Construct's own
`upgradesTo`, not off a hardcoded notion of "two tiers" — Appendix O's
garrison-carrying fix and Appendix N's ghost preview both already generalize
to any chain depth. Adding a third tier was purely data: a new `BuildingDef`
per family with `tier: 3` and no `upgradesTo` of its own, plus the matching
tier-2 gaining an `upgradesTo` pointing at it, and a new procedural mesh per
type (`BuildingShapes.ts`) escalating the same visual language its tier-2
already used (an extra roof, an extra tower, an extra orbiting gem).

**Tier-3 stays out of the shop draft pool on purpose.** `BUILDING_ORDER`
lists tier 1 and tier 2 only; tier-3 `BuildingId`s still need an entry in
`BUILDING_RARITY` (it types as `Record<BuildingId, Rarity>`, exhaustive over
every id) but are never drawn. The top of a family is something earned by
merging, not a fourth card that could show up in a draft.

**`TIER_SCALING` needed a third entry** (`3: 1.9`, alongside the existing
`1: 1` and `2: 1.45`) — the unit-stat multiplier `Sim.spawnUnit` applies is
keyed by tier and would otherwise have silently fallen back to `?? 1` (no
scaling at all) for tier-3 spawns.

Verified via `tsc --noEmit && vite build` (the exhaustive `Record`s over
`BuildingId` catch a missing entry at compile time, not just at runtime) and
a manual pass in the browser: merging two War Lodges/Bowspires/Bastion
Keeps/Arcane Obelisks each produce their tier-3 form with the combined
garrison carried across, same as any other merge.

---

## Appendix U — random merge results, tried and reverted

Requested and built: instead of a merge always producing the same family's
next tier, the result would be drawn at random (equal odds) from every
spawner at that tier — two Barracks might raise a War Lodge again, or just
as easily a Bowspire. Drew from a seeded `Rng` (the same pattern `Shop`'s
draft and `Sim`'s enemy spawns already use) rather than `Math.random()`, so
the roll stays reproducible from the run seed. The ghost preview during a
merge drag stopped showing the *resulting* shape — impossible to know ahead
of a random roll — and just tinted the dragged Construct violet instead,
with the actual result announced in the toast on commit.

**Reverted after a playtest**, on direct feedback: the game already has
wave composition, shop draft, and enemy spawn timing all drawing from RNG,
and adding a coin-flip to merging — a mechanic players build around and
plan ahead for — was one random layer too many. `git revert` cleanly
undid the single commit (data, `Placement`, and `GhostView` changes only;
nothing else had been built on top of it yet), restoring the deterministic
own-family upgrade from Appendix J/T. The tier-3 content from Appendix T
was unaffected either way, since the random-result *mechanism* was layered
on top of the existing deterministic `upgradesTo` chains, not a replacement
for them.

Worth keeping on record: if random merge results come back later (a
separate game mode, say), the seeded-`Rng`-per-candidate-pool approach is
already built and known to work — reverting was a design call, not a
technical dead end.

---

## Appendix V — the four defensive structures get the same merge chain

Requested directly, after asking why some buildings couldn't merge at all:
Palisade, Ballista Turret, Rune Ward, and Healing Shrine had no `upgradesTo`
since Appendix J — "the defensive structures have no tier-2 counterpart
yet" was a deliberate scope cut at the time, not a limitation of the merge
system. Closed that gap so every one of the 8 families (4 spawners, 4
defensive) now chains tier 1 → 2 → 3 the same way:

| Family | Tier 2 | Tier 3 |
|---|---|---|
| Palisade | Reinforced Palisade | Stoneguard Wall |
| Ballista Turret | Heavy Ballista | Siege Ballista |
| Rune Ward | Rune Pillar | Rune Nexus |
| Healing Shrine | Blessed Shrine | Eternal Wellspring |

Costs and HP scale by roughly the same ratios the spawner tiers already
established (~2–2.2× cost per tier); Ballista/Rune Ward's weapon stats
scale similarly tier-over-tier. Tier-2 defensive cards join the shop draft
pool at Rare, matching how tier-2 spawners are already directly purchasable
— tier-3 stays merge-only for all 8 families alike (Appendix T's rule,
just no longer spawner-only).

**One pre-existing gap surfaced, not introduced, by this change.**
Healing Shrine's blurb ("Mends nearby units between clashes") was already
unimplemented — nothing outside `buildings.ts`/`BuildingShapes.ts`/the shop
rarity map ever reads `healing-shrine`, confirmed by grep across `src/`.
Blessed Shrine and Eternal Wellspring inherit the same gap: both are fully
mergeable and functional as HP-only Constructs, but neither actually heals
anyone yet. Flagged rather than silently carried forward, since "the shrine
line now has three tiers" could otherwise read as three tiers of a working
feature.

Verified via `tsc --noEmit && vite build` and a manual pass: merging two of
any defensive tier-1 (or tier-2) now produces its upgrade exactly like a
spawner merge does.

---

## Appendix W — pickup hold delay cut from 380ms to 180ms

Playtest feedback: picking up a Construct to move/merge/sell (the
`LONG_PRESS_MS` hold from Appendix P) felt slow to trigger. Cut the constant
from 380 to 180 — purely a timing number, the pan-vs-pickup disambiguation
logic Appendix P built is unchanged.

**The trade-off is real, not just tuned away.** That delay exists
specifically to tell a deliberate pickup apart from a quick tap-to-inspect
or a pan gesture starting on a built tile (Appendix P). Halving it makes an
accidental pickup more likely on an ordinary tap that lingers slightly. Left
as a number worth revisiting if that trade-off starts showing up in
playtesting, rather than tuned defensively upfront against a problem not
yet observed.

---

## Appendix X — garrisons now reset every wave, and only muster while a wave runs

Two related requests, the second one exposing a bug in the first.

**Request 1: units spawned by a building should be removed after each
wave.** Previously a garrison persisted across waves — a Warrior that
survived one fight walked straight into the next. Added
`Sim.releaseAllGarrisons()`, called from `checkWaveEnd()` the moment a wave
clears: kills every `Category.Unit` entity and zeroes every Construct's
`slotMask` (roster occupancy) in one pass, leaving the Constructs themselves
untouched. Since spawners already muster continuously (that's what drives
the Appendix L cooldown bars even outside combat), the intent was for the
board to visibly empty out and refill from zero during the next Prep.

**Bug, reported directly: the wipe wasn't visible.** Root cause — a
spawner sitting at full roster holds `spawnTimer` at (or below) zero
indefinitely, since `spawnerStep` only resets it after an actual spawn,
never after a blocked attempt (`claimSlot` returning -1). `releaseGarrison`
cleared the roster but left that stale timer in place, so any spawner that
was full when the wave ended immediately refilled one slot on the very next
tick — the kill-and-respawn happened within a single ~33ms frame, before
anything could render. Fix: `releaseAllGarrisons` now also resets
`spawnTimer` to a fresh full interval per Construct, matching what
`addConstruct` already does for a newly placed one.

**Request 2: spawner cooldowns should only tick after a wave starts.**
`spawnerStep` ran unconditionally every tick regardless of `SimPhase`, so a
garrison (freshly wiped or not) quietly kept mustering during Prep too.
Gated the call behind `this.phase === SimPhase.Running` in `Sim.update()` —
a spawner's cooldown bar now sits frozen exactly where it was left through
the whole Prep period and only starts counting down once combat actually
begins.

Verified via `tsc --noEmit && vite build` after each change and reasoning
through the tick order (`spawnerStep` → `waveSpawnStep` → … →
`checkWaveEnd`, all within one `update()` call) to confirm the wipe and the
phase gate interact the way the request needs: nothing spawns during Prep,
and the first post-wipe spawn waits a full interval into the next wave.

---

## Appendix Y — enemies were fighting weaponless walls for entire waves

Reported directly: the game could look stuck when an enemy attacked a
Palisade, taking far too long. Traced to a real, previously-unnoticed
interaction between two existing systems, not a new regression.

**Root cause.** Targets are sticky (Appendix F): an enemy that acquires
*any* Construct within `ENEMY_AGGRO` (1.35 units) stops routing via the
flow field entirely and commits to fighting it to the death, however long
that takes — `enemyStep`'s "stop and fight" branch never re-evaluates
whether going around would be faster. A Palisade has no weapon to fight
back and, across its Appendix V tiers, 420–850 HP. A lone Orc's effective
DPS after the flat 100/(100+armor) mitigation every Construct gets (armor
12) is ~4.87 — killing a base Palisade solo takes roughly **86 seconds** of
nothing else happening, longer for its upgrades. A stray attacker fixating
on a wall read exactly like the game had frozen.

**Fix: enemies now give up on a Construct fight after too long.** `World`
gained three fields — `engageTimer` (seconds held on the current target),
`avoidId`/`avoidTimer` (a specific Construct an enemy just abandoned, and
how long it stays off that enemy's target list). `enemyStep` increments
`engageTimer` while the sticky target is a `Category.Construct`; past
`ENEMY_CONSTRUCT_ENGAGE_LIMIT` (5s) it clears the target, sets `avoidId` to
that Construct with `avoidTimer = ENEMY_CONSTRUCT_AVOID_S` (4s), and falls
through to ordinary flow-field movement the same tick — instead of one more
frozen frame. `Targeting.acquire()` gained an `avoidId` parameter so the
next re-acquisition skips the just-abandoned Construct specifically, rather
than instantly re-locking onto the same nearest target the moment it's
cleared. Only fires for `Team.Shadow` entities against `Category.Construct`
targets; player units' own sticky targeting (Appendix F) is untouched.

**Why this doesn't undermine "a wall slows the horde but can never seal the
board" (Appendix E).** A Palisade genuinely blocking the only route will
still get walked back into repeatedly — the enemy just spends its 5s,
disengages for 4s (during which the flow field can route it around if a
path exists, since Constructs raise path cost rather than blocking), and
tries again if it's still the nearest thing in reach. The wall still costs
the horde real time per attempt; it just can't freeze an entire wave on one
stray attacker anymore.

The 5s/4s constants are a first pass reasoned from the DPS numbers above,
not empirically tuned against playtesting the way earlier appendices'
verified numbers were — worth revisiting if disengage/re-engage cycling
reads as twitchy, or if walls still feel too sticky, once played more.
Verified via `tsc --noEmit && vite build` and tracing the tick order by
hand; not yet re-verified with the sim-driving harness earlier milestones
used.

---

## Appendix Z — two follow-up polish requests

**The Eldree now grows as the board expands.** Requested directly: the
Sacred Tree should read as bigger once a ring unlock (Appendix C) makes the
board bigger. `Eldree.growForRing(ring)` sets a target scale — `0.98` (the
existing base, ring 2, where the board starts) plus `0.22` per ring beyond
that, so `1.20` at the wave-4 ring-3 unlock and `1.42` at the wave-8 ring-4
unlock — and `Eldree.update()` eases toward it every frame with the same
frame-rate-independent exponential ease `CameraRig.tick()` already uses for
its own pull-back, both driven from the same `expandBoard()` call so the
tree growing and the camera reframing read as one animation rather than two
uncoordinated ones. A run restart's `expandBoard(false)` snaps the scale
straight back to base instead of easing down, matching how the camera fit
already snaps on that path.

**The Reroll button no longer looks permanently disabled.** Reported
directly. Its *enabled* style already used `--ink-dim` text on a
near-invisible background — the same look every other disabled control in
`styles.css` uses for its actual disabled state — so `:disabled` only
dropping opacity a further 0.4 was barely perceptible against that already-
muted baseline; affordable and unaffordable read as almost the same button.
Restyled to match the Ready button's own convention instead: gold-tinted
border/background/text while affordable, the dim/muted look reserved for
`:disabled`, plus a press state on tap. No behavior changed, only which
visual state maps to which condition.

Both verified via `tsc --noEmit && vite build`; visual confirmation left to
manual playtesting rather than an automated check, since both are purely
presentational.

---

## Appendix AA — merge affordances: a link beam, and highlights for shop drags too

Two requests, one after the other, both about the same question a player has
mid-drag: *what can this thing combine with?*

**A beam to the target under the finger.** Requested first as "a line to
link the dragging building with the upgradeable building on the base", then
narrowed on sight: the board highlight should stay the way it shows *every*
eligible partner, and the line should only connect the dragged Construct to
the one it is actually about to merge with. `MergeLinks` draws that — from
the lifted Construct's own tile (it stays put visually while lifted) to the
hovered target, hidden the moment the finger moves off a match.

It is driven from `InputController.onBuildingDragMove`, not from
`Placement.onChange`, because the target changes per hover, not per state
transition. `Placement.preview()`/`previewAt()` now *return* the merge target
they already resolved, so main.ts can draw the beam without re-running the
lookup or duplicating the rule.

**Two rendering traps, both worth recording.** A `THREE.LineSegments` was the
obvious first try and rendered as nothing: WebGL clamps line width to ~1px
regardless of `linewidth`, so the beam was invisible at any real screen
scale — the same reason `TileMarker` is a mesh rather than a line. Replacing
it with a ribbon quad was still invisible, for a *different* reason: a ribbon
lying flat in the XZ plane is very nearly edge-on to a camera at this
project's fixed ~62° pitch. Standing the quad up vertically (width measured
on Y, not in the ground plane) is what finally made it read. It also needs
`depthTest: false` — it floats in open air at a height the surrounding tiles
and Constructs otherwise occlude, and it is an indicator, not a scene object.

**Highlights now cover shop drags, not just board drags.** Reported as "when
there is a mergeable building on the base, the dragging building from shop
disappears". Chasing the literal report found no disappearance: the
merge-preview ghost renders correctly for all 16 mergeable types (verified by
driving `previewAt` over a placed Construct of every family and checking the
ghost's geometry), and a merge-on-buy commits correctly. What is really
happening is that hovering a match swaps the ghost from the card's own shape
to the *upgrade's* shape — intended since Appendix N, but with nothing else
marking that tile as special, it reads as the dragged building vanishing and
being replaced.

The real gap behind that: `mergeHighlight` only ever ran for a board-to-board
drag, so dragging a card from the shop lit up nothing at all. Replaced the
'moving'-only branch with `mergeTargetsFor(state)`, which answers the same
question `Placement.mergeTargetAt` commits on (same family, able to upgrade)
for the whole board, and covers `'placing'` and `'moving'` alike — a shop
card now lights up every Construct it could merge into, the same way a lifted
one does. It deliberately covers the tap path too, not just drags: "what can
this combine with?" is the same question whether the card is held or armed.

No beam is drawn for a shop drag: both of its endpoints would be the same
tile, since the "new" Construct only exists as the ghost already standing on
the target.

---

## Appendix AB — hard waves every 5th, and the board grows by surviving them

Requested directly: difficulty spikes on multiples of 5, and after each one
the hex board expands and the Eldree grows with it.

**Hard waves are a transform, not a second table.** `isHardWave(wave)` is
`wave % 5 === 0`; `harden(def)` takes whatever the wave would have been —
authored (waves 1–10) or the post-table scaling formula — and returns it with
`count * 1.5`, `spacing * 0.85`, and one more lane (capped at 6). Layering it
rather than authoring separate hard waves keeps a spike recognisably the same
fight one notch harder, and means it keeps working past the authored table
without a second scaling rule to maintain. Measured: wave 4 sends 14 foes on
3 lanes, hard wave 5 sends 20 on 4; wave 9 sends 32, hard wave 10 sends 60.

**Expansion moved onto the hard-wave beat.** `RING_UNLOCK_WAVE` went from
`[0, 1, 1, 4, 8]` to `[0, 1, 1, 6, 11, 16, 21]` — each ring opens the wave
*after* a hard wave, since `advanceWave()` increments the counter before
calling `unlockForWave`. Surviving the spike is what earns the ground, so the
expansion reads as that fight's reward rather than a schedule running
alongside it.

**The board needed more rings to keep that promise.** "Expands after each
hard wave" only holds for waves 5 and 10 at the old `BOARD_RADIUS = 4`, so it
went to 6: 19 → 37 → 61 → 91 → 127 tiles, full size once wave 20 is held,
with two more `RING_STYLES` entries continuing the existing walk outward
(colder, lower) so the new rings read as terrain falling away rather than
appended. The Eldree growth needed no change — it already keys off
`grid.visibleRing` via `Eldree.growForRing` (Appendix Z), so it grows on the
new schedule for free, reaching scale 1.86 at ring 6. That was checked
visually rather than assumed: at full expansion it reads as proportionate to
the much larger board, so `SCALE_PER_RING` was left at 0.22.

**Two capacity constants were silently sized to the old board** and would
have clipped instancing at 61: `BuildingView`'s `CAPACITY` and main.ts's
`CooldownBarView` allocation. Both now derive from the board itself
(`tileCount(BOARD_RADIUS) - 1` and `grid.cells.length`) so they cannot drift
from `BOARD_RADIUS` again.

Hard waves are announced before they start — `Begin Wave N · Hard` on the
ready button, and a distinct toast on start — so the spike is something to
build toward, not an ambush.

Verified in the browser: the unlock schedule opens 19/37/61/91/127 tiles at
waves 1/6/11/16/21; a full run through wave 6 with a real defence expands the
board only after wave 5 clears; and the full 127-tile board still renders in
**3 draw calls at 120fps**, against the same 60-call budget.

---

## Appendix AC — health bars for Constructs, and the cooldown goes radial

Two requests, one turn: Constructs should show remaining HP, visible only
below full health; and the cooldown indicator should become a circle.

**The health bar is deliberately conditional.** A bar on every Construct at
all times is noise on a board that can hold 126 of them — so its *presence*
is the signal. `syncBars` skips any Construct at `hp >= maxHp`, which means a
healthy board shows nothing at all and a single damaged wall is immediately
findable. The fill is tinted per instance (green above 60%, amber above 30%,
red below), so severity reads without counting pixels; `BarView` only
allocates the `instanceColor` buffer when a caller opts in, so the cooldown
side never paid for it.

**`CooldownBarView` became the generic `BarView`.** With two bar kinds
differing only in colour and what fills them, keeping a cooldown-specific
class would have meant duplicating ~80 lines of instancing and camera-facing
setup. The generic version takes a fill colour and an optional per-instance
tint.

**The ring is a shader, not geometry.** A radial sweep cannot be expressed as
per-instance geometry — `RingGeometry`'s `thetaLength` is fixed at build time
and an `InstancedMesh` shares one geometry across every instance. So
`CooldownRingView` puts progress on an `InstancedBufferAttribute` and does
the sweep in the fragment shader: mask an annulus, convert the fragment's
angle to 0..1 clockwise from the top, and fill everything behind the sweep.
That makes the whole board **one** draw call — fewer than the two the bar
needed, since track and fill are the same pixels here. Edge softening uses a
fixed epsilon rather than `fwidth`, so no derivatives extension is assumed.

**Slot assignment is fixed, not dynamic.** Health takes the slot nearest the
roofline and the ring stacks above it *always*, so a Construct taking its
first hit does not shove its ring upward mid-fight. The cost is a small gap
under the ring on an undamaged Construct, which is the better trade than
indicators that jump during combat.

Verified in the browser against hand-set values: three damaged Constructs
(80%/45%/15%) produced fills of 0.80/0.45/0.15 tinted green/amber/red, the
fourth at full health produced no bar at all, and rings at 25%/75%/100%
swept correctly — with the Palisade correctly showing a health bar and no
ring, having neither spawner nor weapon.

---

## Appendix AD — the curve compounds per era, and a wave that could never end

Requested: difficulty should rise after each hard wave, not just spike on it.

**The mismatch.** Past the authored table the horde grew linearly — `1 +
0.18 * wavesPastTen` off a fixed base. The player does not grow linearly:
strength jumps at each hard wave, when a ring unlocks (a third more tiles)
and the gold from holding the spike buys into it. A linear horde against a
stepped defence falls further behind every era, which is exactly the flat
late game the request describes.

**Now it compounds per era.** `eraOf(wave)` groups waves in fives, and
generated waves scale by `ERA_GROWTH ** eras * WAVE_GROWTH ** withinEra`
(1.45 and 1.08). Each era therefore *starts* about half again as large as
the previous one started, while still ramping gently inside the era:

| wave | 11 | 15 (hard) | 16 | 20 (hard) | 21 | 25 (hard) |
|---|---|---|---|---|---|---|
| old | 46 | 115 | 84 | 167 | 120 | 224 |
| new | 61 | 125 | 92 | 192 | 141 | 292 |

Era openers: 61 → 92 → 141 → 218, a consistent ~1.5x step. The dip that used
to follow a hard wave is gone: wave 11 was 46 against hard wave 10's 60, and
is now 61. Trolls and Wraiths carry an extra `ELITE_GROWTH ** eras` (1.12) so
the elite share climbs 40% → 50% — later eras have to be answered with
armour-piercing and magic-reaching Constructs, not volume. Waves 1–10 keep
their hand-authored shapes untouched; they already step from an era-0 average
of ~10 foes to an era-1 average of ~28.

**The change exposed a latent soft lock.** `Sim.spawnEnemy` incremented
`spawnedTotal` *after* its `if (id < 0) return` guard, while the caller
advanced `entry.spawned` regardless. So an exhausted entity pool meant
`spawnsRemaining` could never reach zero, `checkWaveEnd` never fired, and the
wave hung forever with no enemies left to kill — verified directly: with the
pool filled, a wave sat at `spawnsRemaining: 1`, `enemyCount: 0` for 4000
ticks. The tally now counts spawns *attempted*, so a full pool drops a foe
instead of stranding the run.

**`MAX_ENTITIES` was also sized for the old board.** 512 dates from a 61-tile
board; at 127 tiles a full board of Constructs plus mustered garrisons
measures ~300 on its own, leaving too little headroom for a late wave sending
nearly 300 more. Raised to 1024 (~120 KB of typed arrays, nothing against the
budget) so the authored difficulty actually arrives.

Verified headlessly: waves 11/15/20/25 now deliver 100% of their spawns and
terminate, peak concurrency ~300 against the new 1024 ceiling. A threshold
sweep at wave 25 (292 foes) went defeat at 3 and 6 tier-2 Constructs, held at
12 — with 0 as a control, dying in 14s having killed nothing. Those trials
use idealised compact placement and uniform tier-2 Constructs, so they bound
the curve rather than settle it; `ERA_GROWTH` is the single dial if real play
says otherwise.

---

## Appendix AE — upgrading has to beat spamming

Requested: harder, and more strategic — higher-tier Constructs should carry
more advantage, so the game pushes toward upgrading rather than covering the
board in cheap buildings.

**Spamming was not just viable, it was optimal.** The turret lines made this
plainest: a Ballista does 34 dmg / 1.8s = 18.9 dps, so a Heavy had to beat
37.8 and a Siege 75.6 to be worth the merges. They did 32.7 and 53.8 — a
Siege Ballista delivered *two thirds* of the four Ballistas it was built
from. Walls were the same story (two Palisades 840 hp against one Reinforced
at 610). Only the spawner lines came out ahead, and only because unit `stat`
scaling multiplies hp and damage together, so survivability compounds.

**Every family now beats the sum it replaced**, checked at an equal tile
budget rather than per building:

| line | 4 tiles of tier 1 | 1 tile of tier 3 |
|---|---|---|
| Barracks (dps / hp) | 184 / 1140 | 339 / 1729 |
| Ballista (dps) | 75.6 | 86.4 |
| Rune Ward (dps) | 50.9 | 57.5 |
| Palisade (hp) | 1680 | 2150 |

**Tier scaling grew a qualitative half.** `TIER_SCALING` was one number
multiplying hp and damage; it is now a profile of `stat`, `range` and
`haste` (tier 2 at 1.65 / 1.10 / 0.92, tier 3 at 2.6 / 1.22 / 0.82). Reach
and swing speed are what make a merged garrison play differently rather than
just hit harder — they change where it is worth standing.

**Foes now harden per era, not only multiply.** With the player's power
growing in quality, a horde that only grew in headcount ends up answered by a
handful of tier-3 Constructs forever. `enemyToughness(wave)` scales each
foe's hp and damage by 1.18 per era past the authored table, which buys
difficulty without spending entity budget — a tougher wave costs the same
simulation as a weaker one of the same size. Waves 1–10 are explicitly
excluded: an Orc still has 40 hp through the authored intro, and only reaches
47 at wave 11 and 66 at wave 25. `ERA_GROWTH` eased back 1.6 → 1.5 to pay
for it, so headcount grows more slowly than before while total pressure rises.

Measured as the fewest tiles needed to hold a wave — the question the whole
change is about:

| wave | foes | tier 1 | tier 2 | tier 3 |
|---|---|---|---|---|
| 11 | 62 | 13 | 5 | 4 |
| 15 | 128 | 20 | 8 | 4 |
| 20 | 204 | 26 | 8 | 5 |
| 25 | 321 | 34 | 13 | 5 |

Difficulty now actually climbs (tier-1 demand 13 → 34 tiles where it used to
sit flat around 16–20), and upgrading is worth roughly 7x its tiles by wave
25. Peak concurrency with a full tier-3 board against wave 25 measured 493
entities — comfortably inside the 1024 ceiling raised in Appendix AD, and
proof that ceiling was needed: it would have overrun the old 512.

---

## Appendix AF — the horde could not actually break anything

Reported directly: enemies felt weak, and no Construct was ever destroyed.
Measured before touching anything, at the *marginal* defence where attrition
should show most: wave 15 on 8 tier-2 Constructs finished with **zero**
destroyed and the worst survivor at 82% health; wave 20 with zero destroyed.
The health bars added in Appendix AC had almost nothing to display.

**Why nothing died.** Three things compounded. A Construct carries armour 12,
so it takes ~89% of incoming damage. An Orc deals 6 per 1.1s, which is 4.87
dps after that. And Appendix Y — correctly, to stop an enemy grinding on a
weaponless Palisade for 86 seconds and looking frozen — gives an enemy only
`ENEMY_CONSTRUCT_ENGAGE_LIMIT` (5s) on a Construct before it disengages for
4s. So one Orc's entire commitment to a building removes about 24 damage:
4% of a War Lodge. Buildings were effectively indestructible, and the
anti-freeze fix is what made them so.

**Siege damage, per enemy.** Rather than raise enemy damage across the board
(which would also hit units and the Eldree, and undo balance measured in
Appendix AE), `EnemyDef` gained a `siege` multiplier applied only when a
Shadow entity damages a `Category.Construct`. Orc 2.5, Troll 4.5, Wraith
1.5 — chosen to keep the roster's identities distinct rather than as one
flat number: the Troll becomes the thing that breaks your line, the Orc the
thing that gets past it, and the Wraith already ignores buildings to drift at
the Eldree. Only the direct hit is multiplied, not splash. Appendix Y's
engagement limit is untouched, so the anti-freeze behaviour it bought is
kept — a foe still disengages and reroutes, it just does meaningful work
while it is there.

**It made attrition the cost of spreading thin.** Minimum tiles to hold, and
what holding costs in buildings:

| wave | foes | tier 1 | tier 2 | tier 3 |
|---|---|---|---|---|
| 5 | 20 | 6 | 3 | 3 |
| 10 | 60 | 13 | 5 | 3 |
| 15 | 128 | 20 (lost 3) | 8 | 4 |
| 20 | 204 | 26 (lost 6) | 10 | 5 |
| 25 | 321 | 34 (lost 8) | 16 (lost 1) | 5 |

A tier-1 board holding wave 25 loses 8 Constructs doing it and has to buy
them back; a tier-3 board loses none, because Appendix AE's HP retune made
upgrades genuinely tougher rather than only harder-hitting. Upgrading now
protects the investment as well as out-performing it, which is the second
half of the reason to merge.

Confirmed live as well as in the harness: ten Constructs strung along the
outer ring failed to hold wave 15, buildings visibly dropping through 85%,
81%, 76%, 74% before the Eldree fell — the exact reading the health bars
exist to give.

**Follow-up: the horde's damage doubled, as rate rather than as spikes.**
Requested straight after — enemies still hit too softly — with the
clarification that dps was the number to move. Splitting the doubling across
both terms rather than inflating damage alone keeps a Troll from deleting a
unit in one swing, and makes the horde visibly swing more often, which is
half of why it reads as more aggressive:

| enemy | damage | interval | dps |
|---|---|---|---|
| Orc | 6 → 8 | 1.1 → 0.75 | 5.45 → 10.67 (x1.96) |
| Troll | 22 → 30 | 1.9 → 1.3 | 11.58 → 23.08 (x1.99) |
| Wraith | 11 → 15 | 1.4 → 0.95 | 7.86 → 15.79 (x2.01) |

The early game barely moved — waves 5 and 10 still ask for the same 6 and 13
tier-1 tiles — because those waves are small enough that the defence is
never the bottleneck. The late game tightened where it should: wave 20's
tier-1 requirement went 26 tiles to 34, and wave 25's went 34 to 45 while
the buildings lost holding it rose from 8 to 14. Tier-3 moved barely at all
(5 tiles to 6), so the answer to a harder horde is still to upgrade rather
than to buy more.

---

## Appendix AG — the counter system, made real and made legible

Requested: strengthen the counter system. Two things were wrong with it —
one a bug, one a contradiction between what the game says and what it does.

**The bug: merging broke the only magic line in the game.** `addConstruct`
read `def.id === 'rune-ward' ? Magic : Physical`, a check on the tier-1 id.
So a Rune Pillar and a Rune Nexus — the upgrades a player spends four
purchases and two merges to reach — silently dealt *physical* damage. The
counter identity collapsed exactly when the player committed to it, and
nothing surfaced the change. Damage type is now a field on `BuildingDef`,
so the whole family carries it; verified all three rune tiers read Magic and
the ballista tiers read Physical.

**The contradiction: the blurbs were inverted.** The Ballista said
"Punishes armoured Trolls" while dealing physical into armour 45 — its
*worst* matchup. The Rune Ward said "Wraiths cannot ignore it" while dealing
magic into 60% resistance — also its worst. `Combat.ts` and the README had
it right the whole time (armour → magic answers it, resistance → physical
answers it); the flavour text, and the GDD table written from it, had it
backwards. Fixed in favour of the mechanics, which are the load-bearing
half and the genre convention: magic bypasses plate, arrows still bite a
ghost that shrugs off spells.

**Sharpened, because 1.45x is not a counter.** Troll armour 45 → 110 and
Wraith resistance 0.6 → 0.72:

| | physical | magic | edge |
|---|---|---|---|
| Orc | 1.00 | 1.00 | neutral |
| Troll | 0.48 | 1.00 | magic x2.10 |
| Wraith | 1.00 | 0.28 | physical x3.57 |

**The Rune line could not apply its own advantage.** Even at 2.1x into
Trolls it lost to the Ballista in practice, because it had both lower dps
and *2.0 range against the Ballista's 3.5* — it barely got to fire before
the fight reached it. Reach was the real problem, so the line went to
2.8 / 3.2 / 3.5 (still inside the Ballista's 3.5 / 4.1 / 4.7) with a small
damage bump. Effective dps now favours Rune into Trolls by ~1.8x at every
tier and Ballista into Wraiths by ~4x.

Measured with single-enemy waves against eight of one Construct:

| defence | vs Trolls x12 | vs Wraiths x20 |
|---|---|---|
| Ballista (physical) | 4 killed | **16 killed** |
| Rune Ward (magic) | **8 killed** | 1 killed |
| Archery (physical) | 1 | 11 |
| Mage Spire (magic) | 1 | 0 |

Bringing the wrong damage type into Wraiths costs 15 of 16 kills. That is a
counter system; what was there before was a rounding error.

The point of all of it, measured on the same 20 tiles at wave 15: a board
carrying **both** damage types held 128/128, a physical-only board lost at
80/128, and a magic-only board lost at 55/128. Same tile count, same gold
class, different answer — coverage now beats size. Wave 10 still holds for
all three, so the early game teaches the lesson without enforcing it yet.

**Follow-up: muster cadence cut ~18%.** With the difficulty raised across
Appendices AD–AG, spawner cooldowns came down at every tier (Barracks
6s → 4.9s, Warhost 3.5s → 2.9s, Knight's Hall 10s → 8.2s, and so on for all
twelve). This is worth more than it looks because garrisons reset between
waves and only muster while one runs (Appendix X): muster time is dead time
at the *front of every fight*, and a Warhost Bastion took 24.5s to reach
full strength where it now takes 20.3s.

Cut to a third first, which played too fast — a board came online almost
before the horde arrived, which flattened the opening of every wave into a
formality. Halved the cut back to ~18%, which keeps the ramp legible as a
real pressure while still rewarding the player for having built early.

Worth being precise about what it changed, because it is not what one might
expect. The minimum tiles needed to hold a wave barely moved — that number
is set by steady-state roster dps, which the roster cap fixes regardless of
how fast the slots refill. What dropped was **attrition**: buildings lost
while holding wave 25 on tier-1 Constructs went 14 to 7, and wave 15 went
4 to 3. Faster refills mean a Construct that loses its garrison gets it
back before the next foe arrives, so the defence sustains itself rather than
being chewed down. If the tile requirement itself needs to come down, roster
size or unit stats are the levers, not cadence.

---

## Appendix AH — the Healing Shrine finally does something

The Shrine line had been shipping as decoration since Appendix V flagged it:
three tiers that cost gold, merged correctly, and carried blurbs promising to
mend the garrison, with nothing anywhere in `src/` reading them. It was an
HP-only Construct wearing a support tower's clothes.

**Units, not Constructs.** The blurbs promise a garrison's keeping, and that
is also the right call for balance: letting a shrine repair buildings would
quietly undo the siege pressure Appendix AF exists to create, turning a wall
into something you never have to replace. Enemies are excluded for the
obvious reason, and both exclusions are tested rather than assumed.

**Continuous, not cooldown-driven.** There is no shot to time, so a shrine
shows no cooldown ring — which is why the ring view already skipped it.

**Dedicated `healRate` / `healRange` fields on `World`.** Reusing `damage`
and `range` would have been tempting and wrong: those are exactly what mark
an entity as a turret, so a shrine borrowing them would start acquiring
targets and firing at the horde.

Rates follow the same rule every other family does — a tier beats the sum of
what merged into it: 8 hp/s at tier 1, 18 at tier 2 (over 2x), 38 at tier 3
(over 4x), across auras of 2.4 / 2.9 / 3.4 hex steps. `healStep` runs *after*
`deathStep`, so a unit already reduced to nothing stays dead instead of being
pulled back by healing that landed in the same frame.

Verified by holding the sim in `Running` with an empty spawn queue — spawners
muster and the aura ticks, but no enemy exists to confound the reading. Three
Warriors wounded to 24/95, measured over three seconds:

| | after 3s |
|---|---|
| no shrine (control) | 24 (flat) |
| Healing Shrine, 8/s | 48 |
| Blessed Shrine, 18/s | 78 |
| Eternal Wellspring, 38/s | 95 (capped at max) |

Every rate lands exactly on its number, and healing stops at `maxHp`. The
boundaries hold too: on a full board a garrison 1.73 units from a shrine
healed while one at 7.94 (aura radius 4.16) did not, a Construct inside the
aura was untouched, and an enemy standing directly on the shrine was never
healed.
