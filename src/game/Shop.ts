import { Rng } from '../core/Rng'
import { drawOffer } from '../data/shop'
import type { BuildingId } from '../data/buildings'
import type { Economy } from './Economy'

const REROLL_BASE_COST = 10
const REROLL_STEP = 5
const SKIP_REFUND = 15
const OFFER_SIZE = 3

/**
 * The between-wave build draft: 1-of-3, reroll, or skip.
 *
 * Deliberately does not touch Placement or the building registry — a chosen
 * card only becomes a purchase once the caller arms Placement with it, so this
 * class only ever manages the offer itself and the gold spent shaping it.
 */
export class Shop {
  private offer: BuildingId[] = []
  private rerollCount = 0
  private wave = 1
  private rng: Rng
  isOpen = false

  onOfferChanged: ((offer: readonly BuildingId[], rerollCost: number) => void) | null = null
  onMessage: ((text: string, ok: boolean) => void) | null = null
  onClosed: (() => void) | null = null

  constructor(
    private readonly economy: Economy,
    private readonly seed: number,
  ) {
    this.rng = new Rng(seed)
  }

  get currentOffer(): readonly BuildingId[] {
    return this.offer
  }

  get rerollCost(): number {
    return REROLL_BASE_COST + this.rerollCount * REROLL_STEP
  }

  /** Opens a fresh offer for `wave`. Reseeded per wave, like the sim's own RNG. */
  open(wave: number): void {
    this.wave = wave
    this.rng = new Rng(this.seed * 104729 + wave)
    this.rerollCount = 0
    this.offer = drawOffer(wave, this.rng, OFFER_SIZE)
    this.isOpen = true
    this.onOfferChanged?.(this.offer, this.rerollCost)
  }

  reroll(): void {
    if (!this.economy.spend(this.rerollCost)) {
      this.onMessage?.('Not enough gold to reroll', false)
      return
    }
    this.rerollCount++
    // Continuing the same stream (not reseeding) is what makes each reroll a
    // genuinely fresh draw rather than cycling back through the same offer.
    this.offer = drawOffer(this.wave, this.rng, OFFER_SIZE)
    this.onOfferChanged?.(this.offer, this.rerollCost)
  }

  skip(): void {
    this.economy.grant(SKIP_REFUND)
    this.onMessage?.(`Skipped the offer · +${SKIP_REFUND}g`, true)
    this.close()
  }

  /** Call once the caller has armed Placement with a chosen card. */
  choose(): void {
    this.close()
  }

  private close(): void {
    this.isOpen = false
    this.offer = []
    this.onClosed?.()
  }
}
