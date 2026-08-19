/** Gold. Sourced from kills, wave-clear bonuses and shop skip refunds. */
export class Economy {
  private value: number
  onChange: ((gold: number) => void) | null = null

  constructor(private readonly starting: number) {
    this.value = starting
  }

  /** Returns to the run's starting balance. Called when a fresh run begins. */
  reset(): void {
    this.value = this.starting
    this.onChange?.(this.value)
  }

  get gold(): number {
    return this.value
  }

  canAfford(cost: number): boolean {
    return this.value >= cost
  }

  /** Deducts if affordable. Returns false and changes nothing otherwise. */
  spend(cost: number): boolean {
    if (!this.canAfford(cost)) return false
    this.value -= cost
    this.onChange?.(this.value)
    return true
  }

  grant(amount: number): void {
    this.value += amount
    this.onChange?.(this.value)
  }
}
