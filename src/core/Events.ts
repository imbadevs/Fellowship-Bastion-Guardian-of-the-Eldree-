type Handler<T> = (payload: T) => void

/**
 * Minimal typed event bus.
 *
 * Data flows one way: sim emits, view and UI listen. Nothing in `sim/` ever
 * subscribes to the view, which is what keeps the simulation headless.
 */
export class Emitter<Events extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof Events, Set<Handler<never>>>()

  on<K extends keyof Events>(type: K, handler: Handler<Events[K]>): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler as Handler<never>)
    return () => {
      set.delete(handler as Handler<never>)
    }
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const set = this.handlers.get(type)
    if (!set) return
    for (const handler of set) (handler as Handler<Events[K]>)(payload)
  }
}
