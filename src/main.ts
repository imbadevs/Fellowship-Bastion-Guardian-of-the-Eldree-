import { Loop } from './core/Loop'
import { Rng } from './core/Rng'
import { HexGrid, type Cell } from './hex/HexGrid'
import { CellState } from './data/grid'
import { Renderer } from './view/Renderer'
import { CameraRig } from './view/CameraRig'
import { HexGridView } from './view/HexGridView'
import { TileMarker } from './view/TileMarker'
import { Eldree } from './view/Eldree'
import { InputController } from './view/InputController'
import { BuildingView } from './view/BuildingView'
import { CooldownBarView, type CooldownEntry } from './view/CooldownBarView'
import { buildingHeight } from './view/BuildingShapes'
import { GhostView } from './view/GhostView'
import { Economy } from './game/Economy'
import { BuildingRegistry } from './game/Buildings'
import { Placement } from './game/Placement'
import { Shop } from './game/Shop'
import { Sim, SimPhase } from './sim/Sim'
import { EnemyKind, ENEMY_KINDS } from './data/enemies'
import { enemyGeometry } from './view/EnemyShapes'
import { UnitClass } from './data/buildings'
import { UNIT_CLASSES } from './data/units'
import { unitGeometry } from './view/UnitShapes'
import { ActorView } from './view/ActorView'
import { ProjectileView } from './view/ProjectileView'
import { Category } from './sim/World'
import { MergeHighlight } from './view/MergeHighlight'
import { GameOverPanel } from './ui/GameOverPanel'
import { ShopDock } from './ui/ShopDock'
import { DragChip } from './ui/DragChip'
import { DebugOverlay } from './ui/DebugOverlay'
import { Hud } from './ui/Hud'
import { Toast } from './ui/Toast'
import { InspectPanel } from './ui/InspectPanel'
import { RecycleZone } from './ui/RecycleZone'

const RUN_SEED = 20260818

const canvas = document.querySelector<HTMLCanvasElement>('#game')!
const uiRoot = document.querySelector<HTMLDivElement>('#ui')!

// --- world ------------------------------------------------------------------

const grid = new HexGrid()
let wave = 1
grid.unlockForWave(wave)

const renderer = new Renderer(canvas)
const rig = new CameraRig(renderer.camera)

const gridView = new HexGridView(grid)
renderer.scene.add(gridView.mesh)

const eldree = new Eldree(grid.cells[0]!.surfaceY)
renderer.scene.add(eldree.group)

const hoverMarker = new TileMarker(grid.size, 0x7fd4ff, 0.16)
const selectMarker = new TileMarker(grid.size, 0xf2c464, 0.3, 0.12)
const placeMarker = new TileMarker(grid.size, 0x6ce07a, 0.34, 0.1)
renderer.scene.add(hoverMarker.mesh, selectMarker.mesh, placeMarker.mesh)

const ghost = new GhostView()
renderer.scene.add(ghost.mesh)

const mergeHighlight = new MergeHighlight(renderer.scene, grid.size)

rig.fitBoard(grid.visibleWorldRadius)
rig.reset()

// --- game state -------------------------------------------------------------

const economy = new Economy(400)
const registry = new BuildingRegistry(grid)
const buildingView = new BuildingView(renderer.scene, registry)
const cooldownBars = new CooldownBarView(renderer.scene, 61)

const sim = new Sim(grid, RUN_SEED)
const enemyView = new ActorView(renderer.scene, grid, {
  archetypes: ENEMY_KINDS,
  geometry: (a) => enemyGeometry(a as EnemyKind),
  category: Category.Enemy,
  hover: (a) => (a === EnemyKind.Wraith ? 0.3 : 0),
})
const unitView = new ActorView(renderer.scene, grid, {
  archetypes: UNIT_CLASSES,
  geometry: (a) => unitGeometry(a as UnitClass),
  category: Category.Unit,
})
const projectileView = new ProjectileView(renderer.scene)

registry.onTypeChanged = (id) => {
  buildingView.refresh(id)
  // Occupancy feeds path cost, so any build or sale invalidates the routing.
  sim.rebuildRouting()
}
registry.onPlaced = (building) => {
  building.simId = sim.addConstruct(building.def, building.cell)
}
registry.onRemoved = (building) => {
  sim.removeConstruct(building.simId)
  building.simId = -1
}
registry.onMoved = (building) => {
  sim.moveConstruct(building.simId, building.cell)
}
// A merge is one transition, not a removal followed by a placement — routed
// separately so the sim can carry the combined garrison into the upgrade
// instead of releasing it and mustering the new Construct from zero.
registry.onMerged = (sources, result) => {
  result.simId = sim.mergeConstructs(
    sources.map((s) => s.simId),
    result.def,
    result.cell,
  )
}

// The sim can destroy a Construct (hp reaches 0) independently of the player
// selling it; the registry needs to hear about that so the tile frees up and
// the mesh disappears.
sim.events.onConstructDestroyed = (simId) => {
  for (const building of registry.all()) {
    if (building.simId === simId) {
      registry.remove(building)
      toast.show(`${building.def.name} destroyed`, false)
      break
    }
  }
}

const input = new InputController(canvas, rig, gridView, grid)
const mergeRng = new Rng(RUN_SEED + 1)
const placement = new Placement(registry, economy, ghost, placeMarker, (x, y) => input.pick(x, y), mergeRng)
const shop = new Shop(economy, RUN_SEED)

// --- ui ---------------------------------------------------------------------

const topRegion = document.createElement('div')
topRegion.className = 'region'
const bottomRegion = document.createElement('div')
bottomRegion.className = 'region'
uiRoot.append(topRegion, bottomRegion)

const hud = new Hud(topRegion)
const debug = new DebugOverlay(topRegion)
const toast = new Toast(bottomRegion)
const inspect = new InspectPanel(bottomRegion)

const shopDock = new ShopDock(bottomRegion)
const recycleZone = new RecycleZone(bottomRegion)

const readyBtn = document.createElement('button')
readyBtn.className = 'ready'
readyBtn.addEventListener('click', startWave)
bottomRegion.append(readyBtn)

const devBar = document.createElement('div')
devBar.className = 'dev-bar'
bottomRegion.append(devBar)

const gameOver = new GameOverPanel(uiRoot)
const dragChip = new DragChip()

hud.setWave(wave)
hud.setGold(economy.gold)
hud.setEldree(sim.eldreeHp, sim.eldreeMaxHp)
hud.setProgress(null)

economy.onChange = (gold) => {
  hud.setGold(gold)
  // A placement in flight may have just become unaffordable.
  placement.revalidate()
  shopDock.syncGold(gold)
}

// A purchase arms Placement the same way a tray card once did. The slot is
// only marked "Built" once Placement confirms it actually landed on a tile —
// a mistap or a cancelled drag must leave the slot buyable, not falsely
// marked sold.
let pendingShopIndex = -1

placement.onMessage = (text, ok) => toast.show(text, ok)
placement.onDragMove = (x, y) => dragChip.move(x, y)
placement.onPlaced = () => {
  if (pendingShopIndex >= 0) shop.markBought(pendingShopIndex)
  pendingShopIndex = -1
}
placement.onChange = (state) => {
  dragChip.sync(state)
  shopDock.setArmed(state.kind === 'placing' ? state.defId : null)

  const draggingBuilding = state.kind === 'moving' && state.dragging
  recycleZone.setVisible(draggingBuilding)
  if (!draggingBuilding) recycleZone.setArmed(false)

  if (draggingBuilding && state.building.def.upgradesTo) {
    // Dropping the lifted Construct onto a match merges it — every eligible
    // partner lights up the moment the drag starts, since a mid-drag hover
    // preview alone (see `previewAt`) only shows the *currently hovered* tile.
    const matches = registry
      .ofType(state.building.def.id)
      .filter((b) => b.entityId !== state.building.entityId)
      .map((b) => b.cell)
    mergeHighlight.showAll(matches)
  } else {
    mergeHighlight.hideAll()
  }

  if (state.kind !== 'idle') {
    selectMarker.hide()
    hoverMarker.hide()
    inspect.hide()
    return
  }
  pendingShopIndex = -1
  shop.refresh()
}

// --- shop -----------------------------------------------------------------
// Docked at the bottom for the whole Prep period, not a modal — the board
// stays visible the entire time. Visibility is owned by the same handful of
// call sites that already drive the run's phase, not polled every frame.

shop.onOfferChanged = (offer, bought, rerollCost) => shopDock.show(offer, bought, rerollCost, economy.gold)
shop.onMessage = (text, ok) => toast.show(text, ok)

shopDock.onBuyTap = (index) => {
  const id = shop.currentOffer[index]
  if (id === undefined) return
  pendingShopIndex = index
  placement.beginPurchaseHold(id)
}
shopDock.onBuyDrag = (index, event) => {
  const id = shop.currentOffer[index]
  if (id === undefined) return
  pendingShopIndex = index
  placement.beginPurchaseDrag(id, event)
}
shopDock.onReroll = () => shop.reroll()

function openShop(): void {
  shop.open(wave)
  shopDock.setVisible(true)
}

// --- run flow -----------------------------------------------------------

sim.events.onEldreeDamaged = (hp, max) => {
  hud.setEldree(hp, max)
  eldree.flash()
}

sim.events.onEnemyKilled = (gold) => economy.grant(gold)

sim.events.onWaveCleared = (cleared) => {
  const goldBonus = 40 + cleared * 12
  const heal = Math.min(sim.eldreeMaxHp - sim.eldreeHp, 10 + cleared * 2)
  economy.grant(goldBonus)
  sim.eldreeHp += heal
  hud.setEldree(sim.eldreeHp, sim.eldreeMaxHp)
  hud.setProgress(null)
  toast.show(
    `Wave ${cleared} held · +${goldBonus}g` + (heal > 0 ? ` · Eldree +${heal}hp` : ''),
    true,
  )
  advanceWave()
  openShop()
}

sim.events.onDefeat = () => {
  hud.setProgress(null)
  shopDock.setVisible(false)
  gameOver.show(sim.wave)
}

/** Moves to the next wave and opens any rings it unlocks. */
function advanceWave(): void {
  wave++
  hud.setWave(wave)
  const changed = grid.unlockForWave(wave)
  if (changed.length > 0) expandBoard()
}

/** True once nothing is being placed and combat isn't running. */
function canStartWave(): boolean {
  return sim.phase !== SimPhase.Running && !placement.isActive
}

function startWave(): void {
  if (!canStartWave()) return
  inspect.hide()
  selectMarker.hide()
  shopDock.setVisible(false)
  sim.startWave(wave)
  toast.show(`Wave ${wave} approaches`, false)
}

function restartRun(): void {
  placement.cancel()
  for (const building of [...registry.all()]) registry.remove(building)
  sim.reset()
  economy.reset()
  wave = 1
  hud.setWave(wave)
  hud.setEldree(sim.eldreeHp, sim.eldreeMaxHp)
  hud.setProgress(null)
  for (const cell of grid.cells) if (cell.ring > 0) cell.state = CellState.Locked
  grid.unlockForWave(wave)
  expandBoard(false)
  selectMarker.hide()
  inspect.hide()
  openShop()
}

gameOver.onRestart = restartRun

// --- board interaction ------------------------------------------------------

function describeCell(cell: Cell): string {
  if (cell.state === CellState.Eldree) return 'The Eldree · protect it'
  return `Ring ${cell.ring} · open ground`
}

input.onSelect = (cell) => {
  // A pending placement owns the tap; selection only resumes once it resolves.
  if (placement.tapAt(cell)) return

  if (!cell) {
    selectMarker.hide()
    inspect.hide()
    return
  }

  const building = registry.at(cell)
  selectMarker.setColor(building ? 0xf2c464 : grid.isBuildable(cell) ? 0x7fd4ff : 0xff7a5c)
  selectMarker.show(cell)

  if (building) {
    // A tap always shows the read-only info card; Move/Merge/Sell are all
    // reached by long-press-dragging the Construct itself, not from here.
    const running = sim.phase === SimPhase.Running
    inspect.show(
      building,
      running ? { hp: sim.world.hp[building.simId], maxHp: sim.world.maxHp[building.simId] } : {},
    )
  } else {
    inspect.hide()
    toast.show(describeCell(cell), cell.state === CellState.Open)
  }
}

input.onHover = (cell) => {
  if (placement.isActive) return
  if (cell && cell !== selectMarker.current) hoverMarker.show(cell)
  else hoverMarker.hide()
}

// Long-press any placed Construct to pick it up: drop it on an empty tile to
// move it, on a matching Construct to merge, or on the recycle icon to sell
// it — one drag, three outcomes, disambiguated by Placement/main.ts purely
// from where it lands. Combat-only board rule applies here too: no picking
// anything up mid-wave.
input.onBuildingDragCandidate = (cell) => {
  if (sim.phase === SimPhase.Running) return false
  return !!registry.at(cell)
}
input.onBuildingDragStart = (cell) => {
  const building = registry.at(cell)
  if (!building) return
  selectMarker.hide()
  inspect.hide()
  placement.beginMove(building, true)
}
input.onBuildingDragMove = (x, y, cell) => {
  dragChip.move(x, y)
  placement.previewAt(cell)
  recycleZone.setArmed(recycleZone.contains(x, y))
}
input.onBuildingDragEnd = (cell, x, y) => {
  if (placement.state.kind !== 'moving') return
  if (recycleZone.contains(x, y)) {
    placement.sellDragged()
    return
  }
  placement.tapAt(cell)
}

// --- dev controls -----------------------------------------------------------
// Testing aids only — the real loop is Ready → Wave → Shop → place → Ready.

function devButton(label: string, onClick: (button: HTMLButtonElement) => void): void {
  const button = document.createElement('button')
  button.textContent = label
  button.addEventListener('click', () => onClick(button))
  devBar.append(button)
}

devButton('Smite', () => sim.smiteAll())
devButton('+200', () => economy.grant(200))
devButton('Frame', () => rig.reset())
devButton('Reset', restartRun)

const speeds = [1, 2, 4]
let speedIndex = 0
devButton('1x', (button) => {
  speedIndex = (speedIndex + 1) % speeds.length
  loop.speed = speeds[speedIndex]!
  button.textContent = `${loop.speed}x`
})

// --- loop -------------------------------------------------------------------

function update(dt: number): void {
  sim.update(dt)
}

/** Brings newly unlocked rings into existence and widens the framing to suit. */
function expandBoard(animate = true): void {
  gridView.rebuild()
  rig.fitBoard(grid.visibleWorldRadius, animate)
  countUnlocked()
  // New tiles change what is reachable, so the horde's routing is stale.
  sim.rebuildRouting()
  toast.show(`The bastion expands · ring ${grid.visibleRing}`, true)
}

let unlockedCount = 0
function countUnlocked(): void {
  unlockedCount = 0
  for (const cell of grid.cells) if (cell.state === CellState.Open) unlockedCount++
}
countUnlocked()

let readyLabel = ''
function syncReadyButton(): void {
  const ready = canStartWave()
  const label = ready
    ? `Begin Wave ${wave}`
    : sim.phase === SimPhase.Running
      ? 'The wave rages on'
      : placement.state.kind === 'moving'
        ? 'Move, merge, or sell it'
        : 'Place your Construct'
  if (label === readyLabel) return
  readyLabel = label
  readyBtn.textContent = label
  readyBtn.disabled = !ready
}

/** Clear space between a building's measured roofline and its cooldown bar. */
const COOLDOWN_BAR_MARGIN = 0.18

/** Reused across frames to avoid a per-frame allocation. */
const cooldownEntries: CooldownEntry[] = []

/** Gathers spawn/attack cooldown progress for every Construct that has one. */
function syncCooldownBars(): void {
  cooldownEntries.length = 0
  for (const building of registry.all()) {
    if (building.simId < 0) continue
    const spawn = building.def.spawn
    const weapon = building.def.weapon

    let progress: number
    if (spawn) {
      progress = 1 - sim.world.spawnTimer[building.simId]! / spawn.interval
    } else if (weapon) {
      const interval = sim.world.attackInterval[building.simId]!
      if (interval <= 0) continue
      progress = 1 - sim.world.cooldown[building.simId]! / interval
    } else {
      continue
    }

    cooldownEntries.push({
      worldX: building.cell.worldX,
      worldZ: building.cell.worldZ,
      anchorY: building.cell.surfaceY + buildingHeight(building.def.id) + COOLDOWN_BAR_MARGIN,
      progress,
    })
  }
  cooldownBars.sync(cooldownEntries)
}

function render(alpha: number, wallDt: number): void {
  enemyView.sync(sim.world, alpha, wallDt)
  unitView.sync(sim.world, alpha, wallDt)
  projectileView.sync(sim.projectiles, alpha)
  syncCooldownBars()
  if (sim.phase === SimPhase.Running) hud.setProgress(sim.waveProgress)
  eldree.update(wallDt)
  selectMarker.update(wallDt)
  placeMarker.update(wallDt)
  ghost.update(wallDt)
  mergeHighlight.update(wallDt)
  rig.tick(wallDt)
  renderer.updateFog(rig.cameraDistance, rig.framedRadius)
  renderer.render()
  syncReadyButton()
  debugSource.drawCalls = renderer.drawCalls
  debugSource.triangles = renderer.triangles
  debugSource.wave = wave
  debugSource.unlocked = unlockedCount
  debugSource.buildings = registry.count
  debugSource.enemies = sim.enemyCount
  debugSource.units = sim.world.count - sim.enemyCount - registry.count
  debug.update(wallDt, debugSource)
}

const loop = new Loop(update, render)

/** Reused across frames; the panel repaints at 4 Hz but render runs at vsync. */
const debugSource = {
  stats: loop.stats,
  drawCalls: 0,
  triangles: 0,
  wave,
  cells: grid.cells.length,
  unlocked: 0,
  buildings: 0,
  enemies: 0,
  units: 0,
}

// --- lifecycle --------------------------------------------------------------

const resizeObserver = new ResizeObserver(() => {
  renderer.resize()
  rig.fitBoard(grid.visibleWorldRadius)
})
resizeObserver.observe(canvas)

// Stop simulating while backgrounded; mobile browsers throttle rAF anyway and
// this keeps the accumulator from banking a huge catch-up burst on resume.
document.addEventListener('visibilitychange', () => {
  loop.paused = document.hidden
})

// Escape abandons a pending placement on desktop; tapping empty board does it on touch.
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') placement.cancel()
})

// The very first shop, before any wave has been fought.
openShop()

// Dev-only handle for driving the game from the console — stepping the sim,
// inspecting routing, forcing board states. `import.meta.env.DEV` is statically
// false in a production build, so this whole block is stripped from the bundle.
if (import.meta.env.DEV) {
  Object.assign(window, {
    game: {
      sim,
      grid,
      registry,
      economy,
      shop,
      placement,
      input,
      rig,
      loop,
      gridView,
      enemyView,
      unitView,
      projectileView,
      startWave,
      restartRun,
    },
  })
}

loop.start()
