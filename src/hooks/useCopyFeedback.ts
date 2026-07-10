import { useCallback, useEffect, useRef, useState } from "react";

export type UseCopyFeedback = {
  /** True for `timeoutMs` after a successful copy, then reverts to false. */
  copied: boolean;
  /** Copies `text` to the clipboard; returns whether it succeeded. */
  copy: (text: string) => Promise<boolean>;
};

/**
 * Copies text to the clipboard and exposes a transient `copied` flag so a
 * button can briefly swap to a confirmation (e.g. a green check) before
 * reverting on its own.
 *
 * The revert timer is tracked in a ref and cleared on unmount so we never
 * call `setState` on an unmounted component (also safe under
 * `React.StrictMode`'s double-invocation).
 */
export function useCopyFeedback(timeoutMs = 2000): UseCopyFeedback {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // Clipboard API can be unavailable (e.g. insecure context); the
        // caller keeps the value visible for manual copying.
        return false;
      }

      setCopied(true);
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, timeoutMs);
      return true;
    },
    [timeoutMs],
  );

  return { copied, copy };
}
