import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repo, RepoError } from "./repo";
import type { PaidAnswerResult, PaidPrompt, PaidPromptNotice, PayLinkView } from "./types";

type DbError = { code?: string; message?: string; hint?: string } | null;
type Helpers = {
  ok<T>(result: { data: unknown; error: DbError }): T;
  mapDbError(error: NonNullable<DbError>): RepoError;
};

/** The slice 17 + 19 half of the Supabase repo (the 0015 and 0017 RPCs). */
export function createSupabasePaid(
  client: SupabaseClient,
  { ok, mapDbError }: Helpers,
): Pick<Repo, "openPaidPrompt" | "listPaidPrompts" | "answerPaidPrompt" | "paidPromptNotice" | "tgAnswerPaid" | "payLinkOpen" | "payLinkAnswer"> {
  return {
    async openPaidPrompt(householdId, toUser) {
      return ok<PaidPrompt>(await client.rpc("open_paid_prompt", { p_household: householdId, p_to: toUser }));
    },

    async listPaidPrompts(householdId) {
      const { data, error } = await client.rpc("my_paid_prompts", { p_household: householdId });
      if (error) throw mapDbError(error);
      return (data ?? []) as PaidPrompt[];
    },

    async answerPaidPrompt(promptId, yes) {
      return ok<PaidAnswerResult>(await client.rpc("answer_paid_prompt", { p_prompt: promptId, p_yes: yes }));
    },

    async paidPromptNotice(secret, promptId) {
      return ok<PaidPromptNotice>(await client.rpc("paid_prompt_notice", { p_secret: secret, p_prompt: promptId }));
    },

    async tgAnswerPaid(secret, tgUserId, promptId, yes) {
      return ok<PaidAnswerResult>(
        await client.rpc("tg_answer_paid", { p_secret: secret, p_tg_user_id: tgUserId, p_prompt: promptId, p_yes: yes }),
      );
    },

    async payLinkOpen(secret, code, open) {
      return ok<PayLinkView>(await client.rpc("pay_link_open", { p_secret: secret, p_code: code, p_open: open }));
    },

    async payLinkAnswer(secret, code, promptId, yes) {
      return ok<PaidAnswerResult>(await client.rpc("pay_link_answer", { p_secret: secret, p_code: code, p_prompt: promptId, p_yes: yes }));
    },
  };
}
