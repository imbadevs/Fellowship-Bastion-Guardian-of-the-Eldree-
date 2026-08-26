/**
 * Drop target for selling a Construct mid-drag.
 *
 * Shown only while a board Construct is being carried (Placement's unified
 * move/merge/sell drag), covering the shop dock's own area — nothing there
 * is reachable mid-drag anyway, so replacing it reads clearer than a small
 * floating icon competing for space with the dock. Hit-testing is a plain
 * DOM bounding-box check, not the 3D raycast `pick()` uses for board tiles,
 * since this lives in screen space, not the scene.
 */
export class RecycleZone {
  private readonly el = document.createElement('div')

  constructor(parent: HTMLElement) {
    this.el.className = 'recycle-zone'
    this.el.innerHTML =
      '<svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V4h6v3M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"/>' +
      '<path d="M10 11v6M14 11v6"/></svg><span>Drop to sell</span>'
    parent.append(this.el)
  }

  setVisible(visible: boolean): void {
    this.el.classList.toggle('visible', visible)
  }

  /** Toggled while the drag is currently hovering the zone, for feedback before release. */
  setArmed(armed: boolean): void {
    this.el.classList.toggle('armed', armed)
  }

  contains(clientX: number, clientY: number): boolean {
    if (!this.el.classList.contains('visible')) return false
    const r = this.el.getBoundingClientRect()
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom
  }
}
