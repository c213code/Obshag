import { PAY_CODE_PATTERN, payLinkAnswerBodySchema } from "@/lib/domain/schemas";
import { RepoError, type Repo } from "@/lib/data/repo";
import type { PaidAnswer, PayLinkView } from "@/lib/data/types";
import { askLater, type AskDeps } from "./paidHandler";

/** The pay link has no session: the anon server repo + the server secret are the whole credential. */
export type PayLinkDeps = Omit<AskDeps, "repo"> & { repo: Pick<Repo, "payLinkOpen" | "payLinkAnswer" | "paidPromptNotice"> };

export type PayLinkOutcome<B> = {
  status: 200 | 400 | 403 | 404 | 500;
  body: B;
  /** Runs after the response (Next `after`). Never throws. */
  afterResponse?: () => Promise<void>;
};

export type PayLinkOpenBody = { state: PayLinkView["state"] | "error"; prompt_id: string | null };
export type PayLinkAnswerBody = { result: PaidAnswer | "error" };

/** The page's own read (a plain view: opening a link preview must not count as «opened Kaspi»). null = not configured. */
export async function viewPayLink(code: string, deps: Pick<PayLinkDeps, "repo" | "secret"> | null): Promise<PayLinkView | "error"> {
  if (!PAY_CODE_PATTERN.test(code)) return { state: "expired" };
  if (!deps) return "error";
  try {
    return await deps.repo.payLinkOpen(deps.secret, code, false);
  } catch {
    return "error";
  }
}

/** POST /api/k/<code>/open: the button was pressed. Records the prompt for the link's pair and asks «ты перевёл?» later. */
export async function handlePayLinkOpen(code: string, deps: PayLinkDeps | null): Promise<PayLinkOutcome<PayLinkOpenBody>> {
  if (!PAY_CODE_PATTERN.test(code)) return { status: 404, body: { state: "expired", prompt_id: null } };
  if (!deps) return { status: 500, body: { state: "error", prompt_id: null } };
  try {
    const view = await deps.repo.payLinkOpen(deps.secret, code, true);
    if (view.state === "expired") return { status: 404, body: { state: "expired", prompt_id: null } };
    const promptId = view.prompt_id;
    return {
      status: 200,
      body: { state: view.state, prompt_id: promptId },
      afterResponse: promptId ? () => askLater(promptId, deps) : undefined,
    };
  } catch {
    return { status: 500, body: { state: "error", prompt_id: null } };
  }
}

/** POST /api/k/<code>/answer {prompt_id, yes}: «Да, перевёл» / «Ещё нет». The prompt must belong to this link's pair. */
export async function handlePayLinkAnswer(code: string, raw: unknown, deps: PayLinkDeps | null): Promise<PayLinkOutcome<PayLinkAnswerBody>> {
  if (!PAY_CODE_PATTERN.test(code)) return { status: 404, body: { result: "expired" } };
  const body = payLinkAnswerBodySchema.safeParse(raw);
  if (!body.success) return { status: 400, body: { result: "error" } };
  if (!deps) return { status: 500, body: { result: "error" } };
  try {
    const out = await deps.repo.payLinkAnswer(deps.secret, code, body.data.prompt_id, body.data.yes);
    return { status: 200, body: { result: out.result } };
  } catch (e) {
    if (e instanceof RepoError && (e.code === "forbidden" || e.code === "not_found")) return { status: 403, body: { result: "error" } };
    // a malformed prompt id (22P02) is the caller's mistake
    if (e instanceof RepoError && e.code === "invalid") return { status: 400, body: { result: "error" } };
    return { status: 500, body: { result: "error" } };
  }
}
