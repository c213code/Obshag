import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RepoError } from "@/lib/data/repo";
import type { PaidAnswerResult, PayLinkView } from "@/lib/data/types";
import { PAY_CODE_PATTERN, payLinkAnswerBodySchema } from "@/lib/domain/schemas";
import { ROUTE_MAX_DURATION_S } from "./paidHandler";
import { handlePayLinkAnswer, handlePayLinkOpen, viewPayLink, type PayLinkDeps } from "./payLinkHandler";
import { createRecordingSender } from "./push";

const CODE = "Ab3_x-9QzLm2";
const PROMPT = "123e4567-e89b-42d3-a456-426614174000";
const pay = (over: Partial<Exclude<PayLinkView, { state: "expired" }>> = {}): PayLinkView => ({
  state: "pay", to_name: "Айдос", to_phone: "+77010000002", from_name: "Нурбол", amount: 450, prompt_id: PROMPT, ...over,
});
const make = (over: Partial<PayLinkDeps["repo"]> = {}) => {
  const calls: Array<[string, ...unknown[]]> = [];
  const deps: PayLinkDeps = {
    repo: {
      payLinkOpen: async (secret, code, open) => (calls.push(["open", secret, code, open]), pay({ prompt_id: open ? PROMPT : null })),
      payLinkAnswer: async (secret, code, prompt, yes): Promise<PaidAnswerResult> => (calls.push(["answer", secret, code, prompt, yes]), { result: "marked", to_name: "Айдос" }),
      paidPromptNotice: async () => ({ ask: false }),
      ...over,
    },
    push: createRecordingSender(),
    telegram: null,
    secret: "s3cret",
    wait: async () => undefined,
  };
  return { deps, calls };
};

describe("code and body shapes", () => {
  it("accepts url-safe codes only", () => {
    for (const ok of [CODE, "abcdefgh", "A_-0123456789"]) expect(PAY_CODE_PATTERN.test(ok), ok).toBe(true);
    for (const bad of ["", "short", "has space!!!!", "../etc/passwd", "a".repeat(33), "кириллица-1234"]) expect(PAY_CODE_PATTERN.test(bad), bad).toBe(false);
  });
  it("the answer body is exactly {prompt_id, yes}", () => {
    expect(payLinkAnswerBodySchema.safeParse({ prompt_id: PROMPT, yes: true }).success).toBe(true);
    for (const bad of [{}, { prompt_id: PROMPT }, { prompt_id: PROMPT, yes: "true" }, { prompt_id: PROMPT, yes: true, household_id: "h" }, { prompt_id: "", yes: true }]) {
      expect(payLinkAnswerBodySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
  it("the open route keeps the literal maxDuration the delayed question needs", () => {
    const route = readFileSync(join(process.cwd(), "src/app/api/k/[code]/open/route.ts"), "utf8");
    expect(route).toMatch(new RegExp(`export const maxDuration = ${ROUTE_MAX_DURATION_S};`));
  });
});

describe("viewPayLink (the page)", () => {
  it("only looks: open = false", async () => {
    const { deps, calls } = make();
    expect(await viewPayLink(CODE, deps)).toMatchObject({ state: "pay", prompt_id: null });
    expect(calls).toEqual([["open", "s3cret", CODE, false]]);
  });
  it("a malformed code never reaches the database; no deps / a failing repo read as an error", async () => {
    const { deps, calls } = make();
    expect(await viewPayLink("../x", deps)).toEqual({ state: "expired" });
    expect(calls).toEqual([]);
    expect(await viewPayLink(CODE, null)).toBe("error");
    expect(await viewPayLink(CODE, make({ payLinkOpen: async () => { throw new RepoError("unknown", "x"); } }).deps)).toBe("error");
  });
});

describe("handlePayLinkOpen", () => {
  it("records the prompt and schedules the delayed question", async () => {
    const asked: string[] = [];
    const { deps } = make({ paidPromptNotice: async (_s, id) => (asked.push(id), { ask: false }) });
    const out = await handlePayLinkOpen(CODE, deps);
    expect(out).toMatchObject({ status: 200, body: { state: "pay", prompt_id: PROMPT } });
    expect(asked).toEqual([]);
    await out.afterResponse!();
    expect(asked).toEqual([PROMPT]);
  });
  it("nothing to pay (paid / small) schedules nothing", async () => {
    const out = await handlePayLinkOpen(CODE, make({ payLinkOpen: async () => pay({ state: "paid", prompt_id: null, amount: 0 }) }).deps);
    expect(out).toMatchObject({ status: 200, body: { state: "paid", prompt_id: null } });
    expect(out.afterResponse).toBeUndefined();
  });
  it("expired is 404, a bad code 404, no deps / a failing repo 500", async () => {
    expect((await handlePayLinkOpen(CODE, make({ payLinkOpen: async () => ({ state: "expired" }) }).deps)).status).toBe(404);
    expect((await handlePayLinkOpen("x", make().deps)).status).toBe(404);
    expect((await handlePayLinkOpen(CODE, null)).status).toBe(500);
    expect((await handlePayLinkOpen(CODE, make({ payLinkOpen: async () => { throw new Error("boom"); } }).deps)).status).toBe(500);
  });
});

describe("handlePayLinkAnswer", () => {
  it("passes the code, prompt and answer and returns only the result", async () => {
    const { deps, calls } = make();
    expect(await handlePayLinkAnswer(CODE, { prompt_id: PROMPT, yes: true }, deps)).toEqual({ status: 200, body: { result: "marked" } });
    expect(calls).toEqual([["answer", "s3cret", CODE, PROMPT, true]]);
  });
  it("400 for a wrong body, 403 for somebody else's prompt, 404 bad code, 500 otherwise", async () => {
    const { deps } = make();
    expect((await handlePayLinkAnswer(CODE, { prompt_id: PROMPT }, deps)).status).toBe(400);
    expect((await handlePayLinkAnswer("x", { prompt_id: PROMPT, yes: true }, deps)).status).toBe(404);
    expect((await handlePayLinkAnswer(CODE, { prompt_id: PROMPT, yes: true }, make({ payLinkAnswer: async () => { throw new RepoError("forbidden", "no"); } }).deps)).status).toBe(403);
    expect((await handlePayLinkAnswer(CODE, { prompt_id: PROMPT, yes: true }, make({ payLinkAnswer: async () => { throw new Error("boom"); } }).deps)).status).toBe(500);
    expect((await handlePayLinkAnswer(CODE, { prompt_id: PROMPT, yes: true }, null)).status).toBe(500);
  });
});
