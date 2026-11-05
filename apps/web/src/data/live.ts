// The live-data hook layer (TECHNICAL_SPECS §3, §11): every read goes through these, which unsubscribe on unmount.
// M23: metadata-only snapshots are opt-in (`{ metadata: true }`, for the few places that show pending or cache state),
// errors go to `reportListenerError` (never silently "missing"), and `useLiveDocs` keeps one listener per ID, diffed.

import { useEffect, useMemo, useRef, useState } from "react";
import { doc, onSnapshot, type DocumentData, type DocumentReference, type Query } from "firebase/firestore";
import { db } from "@/firebase/app";
import { tracked } from "@/firebase/listen";
import { KeyedSubscriptions } from "./keyedSubscriptions";
import { reportListenerError } from "./listenErrors";

export interface LiveOptions {
  /** Also re-render on metadata-only changes (pending writes acknowledged, cache → server). Off by default. */
  metadata?: boolean;
}

export interface LiveDoc<T> {
  /** undefined = loading, null = the document doesn't exist (or failed before anything loaded: see `error`). */
  data: T | null | undefined;
  /** The listener failed (permission denied, …). `data` keeps what was last seen. */
  error: Error | null;
  pending: boolean; // local writes not yet acknowledged
  /** The data comes from this device's cache only (reliable with `{ metadata: true }`). */
  fromCache: boolean;
}

const LOADING_DOC = { data: undefined, error: null, pending: false, fromCache: true } as const;

export function useLiveDoc<T>(ref: DocumentReference | null, key: string | null, opts: LiveOptions = {}): LiveDoc<T> {
  const [state, setState] = useState<LiveDoc<T> & { key: string | null }>({ ...LOADING_DOC, key });
  const metadata = !!opts.metadata;
  useEffect(() => {
    if (!ref || !key) return;
    return tracked(
      key,
      onSnapshot(
        ref,
        { includeMetadataChanges: metadata },
        (snap) =>
          setState({
            data: snap.exists() ? (snap.data() as T) : null,
            error: null,
            pending: snap.metadata.hasPendingWrites,
            fromCache: snap.metadata.fromCache,
            key,
          }),
        (error) => {
          reportListenerError(key, error);
          setState((s) => ({ data: s.key === key && s.data !== undefined ? s.data : null, error, pending: false, fromCache: s.key === key ? s.fromCache : true, key }));
        },
      ),
    );
    // `key` identifies the ref; refs aren't referentially stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, metadata]);
  if (state.key !== key) return LOADING_DOC;
  return state;
}

export interface LiveQuery<T> {
  docs: Array<{ id: string; data: T }> | undefined;
  error: Error | null;
  pending: boolean;
  /** The docs come from this device's cache only; the server hasn't confirmed the result yet. */
  fromCache: boolean;
}

const LOADING_QUERY = { docs: undefined, error: null, pending: false, fromCache: true } as const;

export function useLiveQuery<T>(q: Query | null, key: string | null, opts: LiveOptions = {}): LiveQuery<T> {
  const [state, setState] = useState<LiveQuery<T> & { key: string | null }>({ ...LOADING_QUERY, key });
  const metadata = !!opts.metadata;
  useEffect(() => {
    if (!q || !key) return;
    return tracked(
      key,
      onSnapshot(
        q,
        { includeMetadataChanges: metadata },
        (snap) =>
          setState({
            docs: snap.docs.map((d) => ({ id: d.id, data: d.data() as T })),
            error: null,
            pending: snap.metadata.hasPendingWrites,
            fromCache: snap.metadata.fromCache,
            key,
          }),
        (error) => {
          reportListenerError(key, error);
          setState((s) => ({ docs: s.key === key && s.docs ? s.docs : [], error, pending: false, fromCache: s.key === key ? s.fromCache : true, key }));
        },
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, metadata]);
  if (state.key !== key) return LOADING_QUERY;
  return state;
}

/**
 * Documents of one collection by ID, each its own live listener (works for public `get`s signed out). The listeners are
 * diffed: a new ID opens one listener, a dropped ID closes one, the rest stay open (and keep their data). `toValue`
 * must be stable (module level). A missing document is absent from the map; a failed one is absent and reported.
 */
export function useLiveDocs<V>(path: string, ids: readonly string[], toValue: (id: string, data: DocumentData) => V): ReadonlyMap<string, V> {
  const key = useMemo(() => [...new Set(ids)].sort().join(","), [ids]);
  const [state, setState] = useState<{ path: string; map: Map<string, V> }>(() => ({ path, map: new Map() }));
  const subs = useRef<KeyedSubscriptions | null>(null);
  useEffect(() => {
    const s = new KeyedSubscriptions((id) =>
      tracked(
        `${path}/${id}`,
        onSnapshot(
          doc(db, path, id),
          (snap) =>
            setState((prev) => {
              const map = new Map(prev.path === path ? prev.map : []);
              if (snap.exists()) map.set(id, toValue(id, snap.data()));
              else map.delete(id);
              return { path, map };
            }),
          (error) => reportListenerError(`${path}/${id}`, error),
        ),
      ),
    );
    subs.current = s;
    return () => {
      s.close();
      subs.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  useEffect(() => {
    subs.current?.sync(key ? key.split(",") : []);
  }, [key, path]);
  // Only the wanted IDs: a dropped ID's last value stays in state (harmless) until it's wanted again.
  return useMemo(() => {
    if (state.path !== path) return EMPTY_MAP as ReadonlyMap<string, V>;
    const wanted = key ? key.split(",") : [];
    if (wanted.length === state.map.size && wanted.every((id) => state.map.has(id))) return state.map;
    const out = new Map<string, V>();
    for (const id of wanted) {
      const v = state.map.get(id);
      if (v !== undefined) out.set(id, v);
    }
    return out;
  }, [state, key, path]);
}

const EMPTY_MAP: ReadonlyMap<string, unknown> = new Map<string, unknown>();
