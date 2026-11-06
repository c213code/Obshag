/**
 * Auth guard rules. `stage` is how far a user got through onboarding:
 *   0 signed out, 1 signed in without a profile, 2 profile but no household, 3 ready.
 * Each screen declares which kind of page it is; `guardRedirect` says where to send the user (or null to stay).
 */
export type Stage = 0 | 1 | 2 | 3;
export type PageKind = "login" | "onboarding" | "household" | "app";

export function stageOf(s: { hasSession: boolean; hasProfile: boolean; householdCount: number }): Stage {
  if (!s.hasSession) return 0;
  if (!s.hasProfile) return 1;
  return s.householdCount > 0 ? 3 : 2;
}

const HOME: Record<Stage, string> = { 0: "/login", 1: "/onboarding", 2: "/household", 3: "/" };

export function guardRedirect(stage: Stage, page: PageKind): string | null {
  switch (page) {
    case "login":
      return stage >= 1 ? HOME[stage] : null;
    case "onboarding":
      return stage === 1 ? null : HOME[stage];
    case "household":
      return stage >= 2 ? null : HOME[stage];
    case "app":
      return stage === 3 ? null : HOME[stage];
  }
}
