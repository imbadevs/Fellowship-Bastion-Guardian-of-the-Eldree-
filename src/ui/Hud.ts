/**
 * Top-band readout: gold, wave, Eldree health and wave progress.
 *
 * Occupies the space the camera framing reserves above the board. Eldree health
 * is the one number the player must never have to hunt for, so it gets a bar
 * rather than a figure.
 */
export class Hud {
  private readonly goldEl = document.createElement('span')
  private readonly waveEl = document.createElement('span')
  private readonly hpFill = document.createElement('div')
  private readonly hpLabel = document.createElement('span')
  private readonly progressEl = document.createElement('div')

  constructor(parent: HTMLElement) {
    const bar = document.createElement('div')
    bar.className = 'hud'

    const gold = document.createElement('div')
    gold.className = 'hud-stat gold'
    gold.append(document.createTextNode('◆ '), this.goldEl)

    const wave = document.createElement('div')
    wave.className = 'hud-stat'
    wave.append(document.createTextNode('WAVE '), this.waveEl)

    bar.append(gold, wave)

    const health = document.createElement('div')
    health.className = 'eldree-bar'
    this.hpFill.className = 'eldree-fill'
    const track = document.createElement('div')
    track.className = 'eldree-track'
    track.append(this.hpFill)
    this.hpLabel.className = 'eldree-label'
    health.append(track, this.hpLabel)

    this.progressEl.className = 'wave-progress'

    parent.append(bar, health, this.progressEl)
  }

  setGold(gold: number): void {
    this.goldEl.textContent = String(gold)
  }

  setWave(wave: number): void {
    this.waveEl.textContent = String(wave)
  }

  setEldree(hp: number, max: number): void {
    const fraction = max > 0 ? Math.max(0, hp / max) : 0
    this.hpFill.style.width = `${(fraction * 100).toFixed(1)}%`
    this.hpFill.classList.toggle('hurt', fraction <= 0.35)
    this.hpLabel.textContent = `ELDREE ${Math.ceil(hp)}`
  }

  /** Pass null to hide the readout between waves. */
  setProgress(progress: { killed: number; total: number } | null): void {
    if (!progress) {
      this.progressEl.classList.remove('visible')
      return
    }
    this.progressEl.textContent = `${progress.killed} / ${progress.total} slain`
    this.progressEl.classList.add('visible')
  }
}
