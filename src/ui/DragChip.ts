import { BUILDINGS } from '../data/buildings'
import type { PlacementState } from '../game/Placement'

/**
 * The floating glyph that follows a finger while a Construct is being
 * drag-placed. Deliberately its own tiny component: it has to sit above
 * whatever UI initiated the drag (today the Shop, potentially other sources
 * later), not be owned by any one of them.
 */
export class DragChip {
  private readonly el = document.createElement('div')

  constructor() {
    this.el.className = 'drag-chip'
    document.body.append(this.el)
  }

  move(clientX: number, clientY: number): void {
    this.el.style.transform = `translate(${clientX}px, ${clientY}px)`
  }

  sync(state: PlacementState): void {
    const dragging = state.kind === 'placing' && state.dragging
    this.el.classList.toggle('visible', dragging)
    if (state.kind === 'placing') this.el.textContent = BUILDINGS[state.defId].glyph
  }
}
