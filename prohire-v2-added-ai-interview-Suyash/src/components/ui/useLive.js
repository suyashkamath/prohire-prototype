import { useSyncExternalStore, useCallback, useRef } from 'react'
import { subscribe } from '../../lib/db.js'

/**
 * Re-read from storage whenever anything writes.
 *
 * The data layer is synchronous, so this is `useSyncExternalStore` rather than
 * a fetch-and-cache: every screen stays consistent with every other one with no
 * invalidation logic anywhere.
 *
 * The catch `useSyncExternalStore` imposes: `getSnapshot` must return a
 * REFERENTIALLY stable value when the data has not changed, or React loops
 * forever. Our reads build fresh objects every time, so the result is cached
 * against its own JSON and the previous object is handed back when nothing
 * moved. The cache lives in a ref so it survives re-renders.
 */
export function useLive(read, deps = []) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const fn = useCallback(read, deps)
  const cache = useRef({ json: undefined, value: undefined })

  const getSnapshot = useCallback(() => {
    const value = fn()
    const json = JSON.stringify(value)
    if (json !== cache.current.json) cache.current = { json, value }
    return cache.current.value
  }, [fn])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
