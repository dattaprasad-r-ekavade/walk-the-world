import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False during server rendering and hydration, true once running on the
 * client. Lets client-only trees (persisted store, WebGL) wait for hydration
 * without a setState-in-effect round trip.
 */
export function useMounted() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
