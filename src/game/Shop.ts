import { Rng } from '../core/Rng'
import { drawOffer } from '../data/shop'
import type { BuildingId } from '../data/buildings'
import type { Economy } from './Economy'

const REROLL_BASE_COST = 10
const REROLL_STEP = 5
const OFFER_SIZE = 3

/**
 * The between-wave build draft.
 *
 * Not a modal to open and close — the offer is meant to sit docked at the
 * bottom of the screen for the whole Prep period, always visible alongside
 * the board. Every slot the player can afford is buyable, not just one, plus
 * reroll (redraws all 3, at an escalating cost). There is no "skip" action:
 * with nothing to dismiss, the player just buys what they want and taps
 * Ready when done. Deliberately does not touch Placement or the building
 * registry — a bought slot only becomes a real Construct once the caller
 * arms Placement with it, so this class only ever manages the offer itself
 * and the gold spent shaping it.
 */
export class Shop {
  private offer: BuildingId[] = []
  private bought: boolean[] = []
  private rerollCount = 0
  private wave = 1
  private rng: Rng

  onOfferChanged: ((offer: readonly BuildingId[], bought: readonly boolean[], rerollCost: number) => void) | null =
    null
  onMessage: ((text: string, ok: boolean) => void) | null = null

  constructor(
    private readonly economy: Economy,
    private readonly seed: number,
  ) {
    this.rng = new Rng(seed)
  }

  get currentOffer(): readonly BuildingId[] {
    return this.offer
  }

  get boughtFlags(): readonly boolean[] {
    return this.bought
  }

  get rerollCost(): number {
    return REROLL_BASE_COST + this.rerollCount * REROLL_STEP
  }

  /** Draws a fresh offer for `wave`. Reseeded per wave, like the sim's own RNG. */
  open(wave: number): void {
    this.wave = wave
    this.rng = new Rng(this.seed * 104729 + wave)
    this.rerollCount = 0
    this.setOffer(drawOffer(wave, this.rng, OFFER_SIZE))
    this.notify()
  }

  reroll(): void {
    if (!this.economy.spend(this.rerollCost)) {
      this.onMessage?.('Not enough gold to reroll', false)
      return
    }
    this.rerollCount++
    // Continuing the same stream (not reseeding) is what makes each reroll a
    // genuinely fresh draw rather than cycling back through the same offer.
    this.setOffer(drawOffer(this.wave, this.rng, OFFER_SIZE))
    this.notify()
  }

  /** Marks a slot as bought. The other slots stay buyable. */
  markBought(index: number): void {
    if (this.bought[index]) return
    this.bought[index] = true
  }

  /** Redraws the dock against the current offer, e.g. after a placement sub-step resolves. */
  refresh(): void {
    this.notify()
  }

  private setOffer(offer: BuildingId[]): void {
    this.offer = offer
    this.bought = offer.map(() => false)
  }

  private notify(): void {
    this.onOfferChanged?.(this.offer, this.bought, this.rerollCost)
  }
}
