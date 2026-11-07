import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { createSupabaseRepo, mapDbError } from "./supabaseRepo";

const H = "10000000-0000-4000-8000-000000000001";
const U = "00000000-0000-4000-8000-000000000002";

function fake(rpc: Record<string, { data: unknown; error: { code?: string; message?: string } | null }> = {}) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return rpc[fn] ?? { data: null, error: null };
    },
  } as unknown as SupabaseClient;
  return { repo: createSupabaseRepo(client), calls };
}

describe("supabaseRepo bills and Квартира", () => {
  it("maps not_settled", () => {
    expect(mapDbError({ code: "23514", message: "not_settled" }).code).toBe("not_settled");
    expect(mapDbError({ code: "23514", message: "other" }).code).toBe("invalid");
  });

  it("upsertBill validates, then calls the RPC with the amount nulled for a variable bill", async () => {
    const { repo, calls } = fake({ upsert_bill: { data: { id: "b1" }, error: null } });
    const base = { household_id: H, title: " Коммуналка ", icon: "drop" as const, variable: true, day_of_month: 10, payer_id: U, participants: [U] };
    await expect(repo.upsertBill({ ...base, amount: 5000 })).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.upsertBill({ ...base, amount: null, day_of_month: 31 })).rejects.toMatchObject({ code: "invalid" });
    expect(calls).toHaveLength(0);
    await repo.upsertBill({ ...base, amount: null });
    expect(calls[0]).toEqual({
      fn: "upsert_bill",
      args: { p_household: H, p_id: null, p_title: "Коммуналка", p_icon: "drop", p_amount: null, p_variable: true, p_day: 10, p_payer: U, p_participants: [U] },
    });
  });

  it("setBillAmount, runMonthlyBills and the member RPCs send the documented arguments", async () => {
    const { repo, calls } = fake({
      set_bill_amount: { data: { id: "p1", shares: [] }, error: null },
      run_monthly_bills: { data: { created: 1, notices: [] }, error: null },
      rotate_invite_code: { data: { id: H, invite_code: "ABCDEFGHJKLM" }, error: null },
    });
    await expect(repo.setBillAmount("b1", "2026-13", 100)).rejects.toMatchObject({ code: "invalid" });
    await expect(repo.setBillAmount("b1", "2026-11", 0)).rejects.toMatchObject({ code: "invalid" });
    await repo.setBillAmount("b1", "2026-11", 31000);
    expect(await repo.runMonthlyBills("s")).toEqual({ created: 1, notices: [] });
    await repo.setMemberRole(H, U, "admin");
    await repo.removeMember(H, U);
    await repo.leaveHousehold(H);
    expect((await repo.rotateInviteCode(H)).invite_code).toBe("ABCDEFGHJKLM");
    await repo.setAway(H, "2026-11-14");
    await repo.setAway(H, null);
    await expect(repo.setAway(H, "tomorrow")).rejects.toMatchObject({ code: "invalid" });
    await repo.deleteBill("b1");
    expect(calls.map((c) => c.fn)).toEqual([
      "set_bill_amount", "run_monthly_bills", "set_member_role", "remove_member", "leave_household", "rotate_invite_code", "set_away", "set_away", "delete_bill",
    ]);
    expect(calls[0].args).toEqual({ p_bill: "b1", p_month: "2026-11", p_amount: 31000 });
    expect(calls[2].args).toEqual({ p_household: H, p_user: U, p_role: "admin" });
    expect(calls[6].args).toEqual({ p_household: H, p_until: "2026-11-14" });
  });

  it("a database refusal comes back as a repo error", async () => {
    const { repo } = fake({ remove_member: { data: null, error: { code: "23514", message: "not_settled" } }, delete_bill: { data: null, error: { code: "42501" } } });
    await expect(repo.removeMember(H, U)).rejects.toMatchObject({ code: "not_settled" });
    await expect(repo.deleteBill("b1")).rejects.toMatchObject({ code: "forbidden" });
  });
});
