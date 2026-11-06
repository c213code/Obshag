const KEY = "obshak.pendingJoin";

/** A deep link /join/CODE opened while signed out is remembered until the user finishes onboarding. */
export const pendingJoin = {
  get(): string | null {
    try {
      return window.sessionStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  set(code: string) {
    try {
      window.sessionStorage.setItem(KEY, code);
    } catch {
      // private mode: the user can still type the code by hand
    }
  },
  clear() {
    try {
      window.sessionStorage.removeItem(KEY);
    } catch {
      // ignore
    }
  },
};
