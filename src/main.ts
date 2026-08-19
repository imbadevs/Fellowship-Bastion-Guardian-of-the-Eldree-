import { Loop } from './core/Loop'
import { HexGrid, type Cell } from './hex/HexGrid'
import { CellState } from './data/grid'
import { Renderer } from './view/Renderer'
import { CameraRig } from './view/CameraRig'
import { HexGridView } from './view/HexGridView'
import { TileMarker } from './view/TileMarker'
import { Eldree } from './view/Eldree'
import { InputController } from './view/InputController'
import { BuildingView } from './view/BuildingView'
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
import { GameOverPanel } from './ui/GameOverPanel'
import { ShopPanel } from './ui/ShopPanel'
import { DragChip } from './ui/DragChip'
import { DebugOverlay } from './ui/DebugOverlay'
import { Hud } from './ui/Hud'
import { Toast } from './ui/Toast'
import { InspectPanel } from './ui/InspectPanel'

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

rig.fitBoard(grid.visibleWorldRadius)
rig.reset()

// --- game state -------------------------------------------------------------

const economy = new Economy(400)
const registry = new BuildingRegistry(grid)
const buildingView = new BuildingView(renderer.scene, registry)

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
const placement = new Placement(registry, economy, ghost, placeMarker, (x, y) => input.pick(x, y))
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

const readyBtn = document.createElement('button')
readyBtn.className = 'ready'
readyBtn.addEventListener('click', startWave)
bottomRegion.append(readyBtn)

const devBar = document.createElement('div')
devBar.className = 'dev-bar'
bottomRegion.append(devBar)

const gameOver = new GameOverPanel(uiRoot)
const shopPanel = new ShopPanel(uiRoot)
const dragChip = new DragChip()

hud.setWave(wave)
hud.setGold(economy.gold)
hud.setEldree(sim.eldreeHp, sim.eldreeMaxHp)
hud.setProgress(null)

economy.onChange = (gold) => {
  hud.setGold(gold)
  // A placement in flight may have just become unaffordable.
  placement.revalidate()
  if (shop.isOpen) shopPanel.syncGold(gold)
}

placement.onMessage = (text, ok) => toast.show(text, ok)
placement.onDragMove = (x, y) => dragChip.move(x, y)
placement.onChange = (state) => {
  dragChip.sync(state)
  if (state.kind !== 'idle') {
    selectMarker.hide()
    hoverMarker.hide()
    inspect.hide()
  }
}

// --- shop ---------------------------------------------------------------

shop.onOfferChanged = (offer, rerollCost) => shopPanel.show(wave, offer, rerollCost, economy.gold)
shop.onMessage = (text, ok) => toast.show(text, ok)

shopPanel.onBuyTap = (index) => {
  const id = shop.currentOffer[index]
  if (id === undefined) return
  shop.choose()
  shopPanel.hide()
  placement.beginPurchaseHold(id)
}
shopPanel.onBuyDrag = (index, event) => {
  const id = shop.currentOffer[index]
  if (id === undefined) return
  shop.choose()
  shopPanel.hide()
  placement.beginPurchaseDrag(id, event)
}
shopPanel.onReroll = () => shop.reroll()
shopPanel.onSkip = () => {
  shop.skip()
  shopPanel.hide()
}

function openShop(): void {
  shop.open(wave)
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
  gameOver.show(sim.wave)
}

/** Moves to the next wave and opens any rings it unlocks. */
function advanceWave(): void {
  wave++
  hud.setWave(wave)
  const changed = grid.unlockForWave(wave)
  if (changed.length > 0) expandBoard()
}

/** True once the shop is resolved, nothing is being placed, and combat isn't running. */
function canStartWave(): boolean {
  return sim.phase !== SimPhase.Running && !shop.isOpen && !placement.isActive
}

function startWave(): void {
  if (!canStartWave()) return
  inspect.hide()
  selectMarker.hide()
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

inspect.onMove = (building) => {
  selectMarker.hide()
  placement.beginMove(building)
}
inspect.onSell = (building) => {
  selectMarker.hide()
  placement.sell(building)
}
inspect.onClose = () => selectMarker.hide()

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
    // The board is combat-only while a wave is running: inspection drops to a
    // read-only status readout instead of offering Move/Sell.
    const running = sim.phase === SimPhase.Running
    inspect.show(building, running ? { hp: sim.world.hp[building.simId], maxHp: sim.world.maxHp[building.simId], readOnly: true } : {})
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
      : shop.isOpen
        ? 'Resolve the shop'
        : 'Place your Construct'
  if (label === readyLabel) return
  readyLabel = label
  readyBtn.textContent = label
  readyBtn.disabled = !ready
}

function render(alpha: number, wallDt: number): void {
  enemyView.sync(sim.world, alpha, wallDt)
  unitView.sync(sim.world, alpha, wallDt)
  projectileView.sync(sim.projectiles, alpha)
  if (sim.phase === SimPhase.Running) hud.setProgress(sim.waveProgress)
  eldree.update(wallDt)
  selectMarker.update(wallDt)
  placeMarker.update(wallDt)
  ghost.update(wallDt)
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
    game: { sim, grid, registry, economy, shop, rig, loop, gridView, enemyView, unitView, projectileView, startWave, restartRun },
  })
}

loop.start()
