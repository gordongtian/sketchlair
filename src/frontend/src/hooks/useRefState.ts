import { useCallback, useRef, useState } from "react";

/**
 * Like useState, but also maintains a ref that is always in sync with the latest value.
 * Eliminates manual ref = state sync across multiple sites.
 */
export function useRefState<T>(
  initialValue: T,
): [T, React.MutableRefObject<T>, (value: T | ((prev: T) => T)) => void] {
  const [state, setState] = useState<T>(initialValue);
  const ref = useRef<T>(initialValue);

  const setRefState = useCallback((value: T | ((prev: T) => T)) => {
    const next =
      typeof value === "function"
        ? (value as (prev: T) => T)(ref.current)
        : value;
    ref.current = next;
    setState(next);
  }, []);

  return [state, ref, setRefState];
}
