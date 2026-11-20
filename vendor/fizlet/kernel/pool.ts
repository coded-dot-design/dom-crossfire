import { need } from "./need";

/** A bounded pool. Every item is made up front, so acquiring and releasing never allocates and
 *  the pool never grows: when it's full, `acquire()` returns undefined (refuse new work). */
export class Pool<T> {
  readonly cap: number;
  readonly items: T[] = [];
  private readonly f: T[] = []; // the free items (short: esbuild keeps property names)
  constructor(cap: number, create: () => T) {
    this.cap = need(cap, "pool cap", 2);
    for (let i = 0; i < cap; i++) this.f.push(create());
  }
  get size() {
    return this.items.length;
  }
  acquire(): T | undefined {
    const item = this.f.pop();
    if (item !== undefined) this.items.push(item);
    return item;
  }
  /** Swap-remove by index (order is not kept). Iterate backwards when releasing in a loop. */
  releaseAt(i: number): boolean {
    const items = this.items, item = items[i];
    if (item === undefined) return false;
    const last = items.pop()!;
    if (i < items.length) items[i] = last;
    this.f.push(item);
    return true;
  }
  release(item: T) {
    return this.releaseAt(this.items.indexOf(item));
  }
  clear() {
    while (this.items.length) this.releaseAt(this.items.length - 1);
  }
}
