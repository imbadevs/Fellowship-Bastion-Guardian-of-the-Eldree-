/** Transient centre-bottom message. One at a time; a new one replaces the old. */
export class Toast {
  private readonly el = document.createElement('div')
  private timer = 0

  constructor(parent: HTMLElement) {
    this.el.className = 'toast'
    parent.append(this.el)
  }

  show(text: string, ok = true): void {
    this.el.textContent = text
    this.el.classList.toggle('bad', !ok)
    this.el.classList.add('visible')
    clearTimeout(this.timer)
    this.timer = window.setTimeout(() => this.el.classList.remove('visible'), 1600)
  }

  hide(): void {
    clearTimeout(this.timer)
    this.el.classList.remove('visible')
  }
}
