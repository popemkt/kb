/** A keychain kept in a map, so the desktop's tests never touch this machine's. */
import { Effect } from "effect";
import type { Keychain, KeychainItem } from "@kb/keychain";

function id(item: KeychainItem): string {
  return `${item.service}/${item.account ?? ""}`;
}

export function memoryKeychain(): Keychain & { readonly items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    read: (item) => Effect.sync(() => items.get(id(item)) ?? null),
    write: (item, value) => Effect.sync(() => void items.set(id(item), value)),
    erase: (item) => Effect.sync(() => void items.delete(id(item))),
  };
}
