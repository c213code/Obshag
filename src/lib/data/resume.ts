export const RESUME_MIN_GAP_MS = 30_000;
export const RESUME_DELAY_MS = 400;

type Timers = {
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
};

export type ResumeOptions = {
  /** The silent refresh. */
  run(): Promise<void>;
  /** False while signed out / still onboarding: nothing to refresh. */
  enabled(): boolean;
  now?(): number;
  minGapMs?: number;
  delayMs?: number;
} & Partial<Timers>;

/**
 * Coming back to the app (visibilitychange only): refresh at most once per `minGapMs`, a moment AFTER the screen is
 * visible so the resume itself stays smooth, and never two refreshes at once (a running one is reused).
 */
export function createResumeRefresher(opts: ResumeOptions) {
  const now = opts.now ?? Date.now;
  const gap = opts.minGapMs ?? RESUME_MIN_GAP_MS;
  const delay = opts.delayMs ?? RESUME_DELAY_MS;
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let last = now();
  let timer: unknown = null;
  let running: Promise<void> | null = null;

  const fire = (): Promise<void> => {
    timer = null;
    if (running) return running;
    running = opts.run().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    /** Call with `document.visibilityState === "visible"`. */
    onVisibilityChange(visible: boolean): void {
      if (!visible) {
        if (timer !== null) {
          clearTimer(timer); // hidden again before the delay passed: do not refresh in the background
          timer = null;
        }
        return;
      }
      if (!opts.enabled() || timer !== null) return;
      const t = now();
      if (t - last < gap) return;
      last = t;
      timer = setTimer(() => void fire(), delay);
    },
    dispose(): void {
      if (timer !== null) clearTimer(timer);
      timer = null;
    },
    /** Test hook: the refresh in flight, if any. */
    get inFlight(): Promise<void> | null {
      return running;
    },
  };
}
