"use client";

import { useEffect } from "react";
import { LazyMotion, MotionConfig, type FeatureBundle } from "motion/react";
import { registerServiceWorker } from "@/lib/pwa";

const noFeatures = {} as FeatureBundle;

// Offline (the worker's /offline page) or a failed chunk: the few remaining motion components just stay static.
const loadFeatures = () =>
  navigator.onLine
    ? import("@/lib/motion/features")
        .then((mod) => mod.default)
        .catch(() => noFeatures)
    : Promise.resolve(noFeatures);

/** Respect prefers-reduced-motion globally: transforms are dropped, opacity stays. */
export function Providers({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // Lets E2E tests wait until taps will actually reach React handlers.
    document.documentElement.dataset.hydrated = "true";
    registerServiceWorker();
  }, []);
  return (
    <MotionConfig reducedMotion="user">
      <LazyMotion features={loadFeatures}>{children}</LazyMotion>
    </MotionConfig>
  );
}
