"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "@/lib/clipboard";

const key = (userId: string) => `obshak:kaspi-copied:${userId}`;

function remembered(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(key(userId)) === "1";
  } catch {
    return false;
  }
}

/**
 * The creditor's Kaspi number on the clipboard. It is copied by the first tap anywhere on the screen (inside that
 * gesture, so iOS allows it) or by tapping the bar; `copied` survives a reload for this tab (sessionStorage, per person).
 */
export function useKaspiCopy(userId: string, phone: string | null) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const done = useRef(false);

  // the remembered state is read after mount, so the server render and the first client render agree
  useEffect(() => {
    done.current = remembered(userId);
    setCopied(done.current);
    setFailed(false);
  }, [userId]);

  const copy = useCallback((): Promise<boolean> => {
    if (!phone) return Promise.resolve(false);
    return copyText(phone).then((ok) => {
      done.current = ok;
      setCopied(ok);
      setFailed(!ok);
      if (ok) {
        try {
          window.sessionStorage.setItem(key(userId), "1");
        } catch {
          // private mode: the chip still shows for this visit
        }
      }
      return ok;
    });
  }, [phone, userId]);

  // first gesture on the screen copies the number (capture: before the tapped control's own handler)
  useEffect(() => {
    if (!phone) return;
    const onFirstTap = () => {
      if (done.current) return;
      void copy();
    };
    document.addEventListener("click", onFirstTap, { capture: true, once: true });
    return () => document.removeEventListener("click", onFirstTap, { capture: true });
  }, [phone, copy, userId]);

  return { copied, failed, copy };
}
