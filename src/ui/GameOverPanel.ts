/** Run-over screen. Blocks the board so a defeat cannot be misread as a pause. */
export class GameOverPanel {
  private readonly el = document.createElement('div')
  private readonly detail = document.createElement('p')

  onRestart: (() => void) | null = null

  constructor(parent: HTMLElement) {
    this.el.className = 'gameover'

    const title = document.createElement('h1')
    title.textContent = 'The Eldree has fallen'
    this.detail.className = 'gameover-detail'

    const button = document.createElement('button')
    button.textContent = 'Begin again'
    button.addEventListener('click', () => {
      this.hide()
      this.onRestart?.()
    })

    this.el.append(title, this.detail, button)
    parent.append(this.el)
  }

  show(wave: number): void {
    this.detail.textContent = `The shadow broke through on wave ${wave}.`
    this.el.classList.add('visible')
  }

  hide(): void {
    this.el.classList.remove('visible')
  }
}
