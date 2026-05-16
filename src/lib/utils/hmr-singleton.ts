/**
 * Stash a singleton on `globalThis` so it survives Next dev's module
 * re-imports. The class constructor itself is stashed alongside; on
 * re-import we compare identities and dispose the stale instance if
 * the bundle's class has changed (i.e. an HMR cycle).
 *
 * Without this, every edit to a broker module leaks the previous
 * instance's timers and sockets forever — the new module body returns
 * the OLD instance via the stash, but its methods belong to the dead
 * bundle so any new feature added in the edit is silently inactive
 * until the dev server is restarted.
 *
 * @example
 *   class MyBroker { dispose() { ... } ... }
 *   export const myBroker = hmrSingleton("my-broker-v2", MyBroker);
 */
export interface Disposable {
  dispose(): void;
}

export function hmrSingleton<T extends Disposable>(
  key: string,
  ctor: new () => T
): T {
  const instanceKey = `__hmr_singleton_${key}__`;
  const classKey = `__hmr_singleton_${key}_class__`;

  type Holder = {
    [k: string]: unknown;
  };
  const holder = globalThis as unknown as Holder;

  if (holder[classKey] && holder[classKey] !== ctor) {
    const stale = holder[instanceKey] as Disposable | undefined;
    if (stale && typeof stale.dispose === "function") {
      try {
        stale.dispose();
      } catch {
        /* old bundle may be partly broken; ignore */
      }
    }
    delete holder[instanceKey];
  }
  holder[classKey] = ctor;

  let instance = holder[instanceKey] as T | undefined;
  if (!instance) {
    instance = new ctor();
    holder[instanceKey] = instance;
  }
  return instance;
}
