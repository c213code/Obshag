import { domMax } from "motion/react";

/**
 * Feature bundle of the remaining motion/react users (the swipe drag, `AnimatePresence` cross-fades on rare screens).
 * Loaded lazily by `LazyMotion` in Providers, so it stays out of the first-load JS. `domMax` because the swipe needs `drag`.
 */
export default domMax;
