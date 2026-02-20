import type { EventHandler } from '../types.js';

type EventKey<Events> = {
  [K in keyof Events]-?: NonNullable<Events[K]> extends (...args: any[]) => void ? K : never;
}[keyof Events];

export class TypedEventEmitter<Events extends object> {
  private handlers: Partial<Record<keyof Events, Set<(...args: any[]) => void>>> = {};

  on<K extends EventKey<Events>>(event: K, handler: EventHandler<Events, K>): void {
    const set = this.handlers[event] ?? new Set<(...args: any[]) => void>();
    set.add(handler as (...args: any[]) => void);
    this.handlers[event] = set;
  }

  off<K extends EventKey<Events>>(event: K, handler: EventHandler<Events, K>): void {
    const set = this.handlers[event];
    if (!set) return;
    set.delete(handler as (...args: any[]) => void);
    if (set.size === 0) {
      delete this.handlers[event];
    }
  }

  emit<K extends EventKey<Events>>(event: K, ...args: Parameters<EventHandler<Events, K>>): void {
    const set = this.handlers[event];
    if (!set || set.size === 0) return;

    for (const handler of set) {
      (handler as (...eventArgs: Parameters<EventHandler<Events, K>>) => void)(...args);
    }
  }

  removeAllListeners(): void {
    this.handlers = {};
  }
}
