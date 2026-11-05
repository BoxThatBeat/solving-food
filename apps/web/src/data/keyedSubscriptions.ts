// One live subscription per ID, diffed (M23): when the wanted set changes, only the added IDs are subscribed and only the
// removed ones unsubscribed; the rest keep their listener (and their data). Used by `useLiveDocs` (live.ts).

export class KeyedSubscriptions {
  private subs = new Map<string, () => void>();

  constructor(private readonly open: (id: string) => () => void) {}

  /** Makes the open subscriptions exactly `ids`. Returns what changed. */
  sync(ids: Iterable<string>): { added: string[]; removed: string[] } {
    const wanted = new Set(ids);
    const removed: string[] = [];
    for (const [id, unsub] of this.subs) {
      if (wanted.has(id)) continue;
      unsub();
      this.subs.delete(id);
      removed.push(id);
    }
    const added: string[] = [];
    for (const id of wanted) {
      if (this.subs.has(id)) continue;
      this.subs.set(id, this.open(id));
      added.push(id);
    }
    return { added, removed };
  }

  has(id: string): boolean {
    return this.subs.has(id);
  }

  get size(): number {
    return this.subs.size;
  }

  close(): void {
    for (const unsub of this.subs.values()) unsub();
    this.subs.clear();
  }
}
