/**
 * Event multiplexer for VoiceRuntime.
 *
 * PackageBackedVoiceRuntime only supports one handler per event type
 * (this.handlers[event] = handler). This utility fans out a single
 * runtime handler to multiple listeners so that use-runtime, use-audio,
 * and use-benchmark can all subscribe without overwriting each other.
 */

import type { VoiceRuntime, VoiceRuntimeEvents } from '../../../voice/types.js';

export type EventMux = {
  on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void;
};

export function createEventMux(runtime: VoiceRuntime): EventMux {
  const registered = new Map<string, Function[]>();

  return {
    on<K extends keyof VoiceRuntimeEvents>(event: K, handler: VoiceRuntimeEvents[K]): void {
      const key = event as string;
      if (!registered.has(key)) {
        registered.set(key, []);
        // Register a single fan-out handler on the actual runtime.
        // All subsequent listeners for this event go through the fan-out.
        runtime.on(event, ((...args: unknown[]) => {
          for (const h of registered.get(key)!) {
            h(...args);
          }
        }) as VoiceRuntimeEvents[K]);
      }
      registered.get(key)!.push(handler as Function);
    },
  };
}
