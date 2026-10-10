// The live-data hook layer (TECHNICAL_SPECS §3, §11): every read goes through these, which unsubscribe on unmount.

import { useEffect, useState } from "react";
import { onSnapshot, type DocumentReference, type Query } from "firebase/firestore";

export interface LiveDoc<T> {
  data: T | null | undefined; // undefined = loading, null = missing
  error: Error | null;
  pending: boolean; // local writes not yet acknowledged
}

export function useLiveDoc<T>(ref: DocumentReference | null, key: string | null): LiveDoc<T> {
  const [state, setState] = useState<LiveDoc<T> & { key: string | null }>({
    data: undefined,
    error: null,
    pending: false,
    key,
  });
  useEffect(() => {
    if (!ref) return;
    return onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          data: snap.exists() ? (snap.data() as T) : null,
          error: null,
          pending: snap.metadata.hasPendingWrites,
          key,
        }),
      (error) => setState({ data: null, error, pending: false, key }),
    );
    // `key` identifies the ref; refs aren't referentially stable across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.key !== key) return { data: undefined, error: null, pending: false };
  return state;
}

export interface LiveQuery<T> {
  docs: Array<{ id: string; data: T }> | undefined;
  error: Error | null;
  pending: boolean;
}

export function useLiveQuery<T>(q: Query | null, key: string | null): LiveQuery<T> {
  const [state, setState] = useState<LiveQuery<T> & { key: string | null }>({
    docs: undefined,
    error: null,
    pending: false,
    key,
  });
  useEffect(() => {
    if (!q) return;
    return onSnapshot(
      q,
      { includeMetadataChanges: true },
      (snap) =>
        setState({
          docs: snap.docs.map((d) => ({ id: d.id, data: d.data() as T })),
          error: null,
          pending: snap.metadata.hasPendingWrites,
          key,
        }),
      (error) => setState({ docs: [], error, pending: false, key }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (state.key !== key) return { docs: undefined, error: null, pending: false };
  return state;
}
