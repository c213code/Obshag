import { describe, expect, it, vi } from "vitest";
import { createResumeRefresher } from "./resume";

function setup(enabled = true) {
  let clock = 1_000_000;
  const timers: Array<{ fn: () => void; ms: number; live: boolean }> = [];
  const run = vi.fn(() => Promise.resolve());
  const r = createResumeRefresher({
    run,
    enabled: () => enabled,
    now: () => clock,
    setTimer: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      (h as { live: boolean }).live = false;
    },
  });
  const flush = () => timers.filter((t) => t.live).forEach((t) => ((t.live = false), t.fn()));
  return { r, run, timers, flush, advance: (ms: number) => (clock += ms) };
}

describe("resume refresher", () => {
  it("waits 400 ms after becoming visible, then refreshes once", () => {
    const { r, run, timers, flush, advance } = setup();
    advance(31_000);
    r.onVisibilityChange(true);
    expect(timers[0].ms).toBe(400);
    expect(run).not.toHaveBeenCalled();
    flush();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("ignores a second resume inside the 30 s gap", async () => {
    const { r, run, flush, advance } = setup();
    advance(31_000);
    r.onVisibilityChange(true);
    flush();
    await r.inFlight;
    advance(10_000);
    r.onVisibilityChange(true);
    flush();
    expect(run).toHaveBeenCalledTimes(1);
    advance(21_000);
    r.onVisibilityChange(true);
    flush();
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not refresh right after the first load (gap counts from creation)", () => {
    const { r, run, flush, advance } = setup();
    advance(5_000);
    r.onVisibilityChange(true);
    flush();
    expect(run).not.toHaveBeenCalled();
  });

  it("cancels when hidden again before the delay, and does nothing while disabled", () => {
    const { r, run, flush, advance } = setup();
    advance(31_000);
    r.onVisibilityChange(true);
    r.onVisibilityChange(false);
    flush();
    expect(run).not.toHaveBeenCalled();
    const off = setup(false);
    off.advance(31_000);
    off.r.onVisibilityChange(true);
    off.flush();
    expect(off.run).not.toHaveBeenCalled();
  });

  it("reuses a refresh that is still running", async () => {
    let finish: () => void = () => undefined;
    const clock = { t: 1_000_000 };
    const timers: Array<() => void> = [];
    const run = vi.fn(() => new Promise<void>((res) => (finish = res)));
    const r = createResumeRefresher({ run, enabled: () => true, now: () => clock.t, minGapMs: 0, setTimer: (fn) => timers.push(fn), clearTimer: () => undefined });
    r.onVisibilityChange(true);
    timers.shift()?.();
    r.onVisibilityChange(true);
    timers.shift()?.();
    expect(run).toHaveBeenCalledTimes(1);
    finish();
    await r.inFlight;
    expect(r.inFlight).toBeNull();
  });
});
