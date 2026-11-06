"use client";

import { useEffect } from "react";
import { MotionConfig } from "motion/react";

/** Respect prefers-reduced-motion globally: transforms are dropped, opacity stays. */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Lets E2E tests wait until taps will actually reach React handlers.
    document.documentElement.dataset.hydrated = "true";
  }, []);
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
