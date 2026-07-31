/**
 * AppState — typed stateful store for top-level UI state.
 *
 * Mirrors the EventBus shape in app-events.ts but holds state instead of
 * firing-and-forgetting: get() reads the current value, set() emits
 * synchronously, on() subscribes (returning an unsubscribe). Consumers
 * (e.g. the dialog host in dialog-service.ts) react to state transitions.
 */

export interface DialogState {
  id: string
  sessionId: string
  payload: unknown
}

export interface AppStateSlices {
  dialog: DialogState | null
}

export class StateStore<S> {
  private state: S
  private listeners = new Map<keyof S, Set<(value: unknown) => void>>()

  constructor(initial: S) {
    this.state = { ...initial }
  }

  get<K extends keyof S>(key: K): S[K] {
    return this.state[key]
  }

  set<K extends keyof S>(key: K, value: S[K]): void {
    if (this.state[key] === value) return
    this.state = { ...this.state, [key]: value }
    this.listeners.get(key)?.forEach((handler) => handler(value))
  }

  on<K extends keyof S>(key: K, handler: (value: S[K]) => void): () => void {
    const fn = handler as (value: unknown) => void
    if (!this.listeners.has(key)) this.listeners.set(key, new Set())
    this.listeners.get(key)!.add(fn)
    return () => {
      this.listeners.get(key)?.delete(fn)
    }
  }
}

export const appState = new StateStore<AppStateSlices>({
  dialog: null,
})
