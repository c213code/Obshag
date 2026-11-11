import type { SupabaseClient } from "@supabase/supabase-js";
import { RepoError, type Repo } from "./repo";
import type { Duty, DutyDay, DutyEvent, DutyEventNotice, DutyMorningItem, DutyNotice, SwapRequest, TgSwapResult } from "./types";

type DbError = { code?: string; message?: string; hint?: string } | null;
type Helpers = {
  ok<T>(result: { data: unknown; error: DbError }): T;
  mapDbError(error: NonNullable<DbError>): RepoError;
};

type DutyRow = Omit<Duty, "order">;
type DutyDayRow = { day: string; user_id: string; source: DutyDay["source"]; done: boolean; request_id: string | null; skipped_user: string | null };

/** The slice 14 half of the Supabase repo (reads are RLS-filtered selects, writes are the 0012 RPCs). */
export function createSupabaseDuty(
  client: SupabaseClient,
  { ok, mapDbError }: Helpers,
): Pick<
  Repo,
  | "listDuties"
  | "dutySchedule"
  | "listSwapRequests"
  | "getSwapRequest"
  | "createDuty"
  | "setDutyOrder"
  | "adminAssignDay"
  | "markDutyDone"
  | "requestSwap"
  | "respondSwap"
  | "cancelSwap"
  | "swapNotice"
  | "runDutyMorning"
  | "tgRespondSwap"
  | "listDutyEvents"
  | "dutyDoneEvent"
  | "dutyPing"
  | "waterEmpty"
  | "waterBrought"
  | "waterBottleUsed"
  | "setWaterPrice"
  | "dutyEventNotice"
> {
  const COLUMNS = "id, household_id, kind, title, start_date, active, price_per_liter, bottle_liters, bottles_total, bottles_full";

  async function orderOf(dutyId: string): Promise<string[]> {
    const { data, error } = await client.from("duty_members").select("user_id, position").eq("duty_id", dutyId).order("position");
    if (error) throw mapDbError(error);
    return ((data ?? []) as Array<{ user_id: string }>).map((r) => r.user_id);
  }
  const withOrder = async (row: DutyRow): Promise<Duty> => ({ ...row, order: await orderOf(row.id) });
  const toRequest = (r: SwapRequest): SwapRequest => ({
    id: r.id,
    duty_id: r.duty_id,
    from_user: r.from_user,
    from_day: r.from_day,
    to_user: r.to_user,
    to_day: r.to_day,
    reason: r.reason,
    status: r.status,
    expires_at: r.expires_at,
    created_at: r.created_at,
    decided_at: r.decided_at,
  });

  return {
    async listDuties(householdId) {
      const { data, error } = await client
        .from("duties")
        .select(`${COLUMNS}, duty_members(user_id, position)`)
        .eq("household_id", householdId)
        .eq("active", true)
        .order("created_at");
      if (error) throw mapDbError(error);
      type Row = DutyRow & { duty_members: Array<{ user_id: string; position: number }> };
      return ((data ?? []) as unknown as Row[]).map(({ duty_members, ...row }) => ({
        ...row,
        order: [...duty_members].sort((a, b) => a.position - b.position).map((m) => m.user_id),
      }));
    },

    async dutySchedule(dutyId, from, to) {
      const rows = ok<DutyDayRow[]>(await client.rpc("duty_schedule", { p_duty: dutyId, p_from: from, p_to: to }));
      return rows.map((r) => ({
        day: r.day,
        user_id: r.user_id,
        source: r.source,
        done: r.done,
        request_id: r.request_id ?? null,
        skipped_user: r.skipped_user ?? null,
      }));
    },

    async listSwapRequests(dutyId) {
      const { data, error } = await client
        .from("duty_swap_requests")
        .select("*")
        .eq("duty_id", dutyId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw mapDbError(error);
      return ((data ?? []) as SwapRequest[]).map(toRequest);
    },

    async getSwapRequest(requestId) {
      const { data, error } = await client.from("duty_swap_requests").select("*").eq("id", requestId).maybeSingle();
      if (error) throw mapDbError(error);
      if (!data) throw new RepoError("not_found", "Request not found");
      return toRequest(data as SwapRequest);
    },

    async createDuty(input) {
      const row = ok<DutyRow>(
        await client.rpc("create_duty", {
          p_household: input.household_id,
          p_kind: input.kind,
          p_title: input.title,
          p_start: input.start_date ?? null,
          p_order: input.order ?? null,
        }),
      );
      return withOrder(row);
    },

    async setDutyOrder(dutyId, order, startDate) {
      const row = ok<DutyRow>(await client.rpc("set_duty_order", { p_duty: dutyId, p_order: order, p_start: startDate ?? null }));
      return withOrder(row);
    },

    async adminAssignDay(dutyId, day, userId) {
      const { error } = await client.rpc("admin_assign_day", { p_duty: dutyId, p_day: day, p_user: userId });
      if (error) throw mapDbError(error);
    },

    async markDutyDone(dutyId, day) {
      const { error } = await client.rpc("mark_duty_done", { p_duty: dutyId, p_day: day });
      if (error) throw mapDbError(error);
    },

    async requestSwap(dutyId, myDay, otherDay, reason) {
      return toRequest(
        ok<SwapRequest>(await client.rpc("request_swap", { p_duty: dutyId, p_my_day: myDay, p_other_day: otherDay, p_reason: reason ?? null })),
      );
    },

    async respondSwap(requestId, accept) {
      return toRequest(ok<SwapRequest>(await client.rpc("respond_swap", { p_request: requestId, p_accept: accept })));
    },

    async cancelSwap(requestId) {
      return toRequest(ok<SwapRequest>(await client.rpc("cancel_swap", { p_request: requestId })));
    },

    async swapNotice(secret, requestId, event) {
      return ok<DutyNotice>(await client.rpc("swap_notice", { p_secret: secret, p_request: requestId, p_event: event }));
    },

    async runDutyMorning(secret) {
      return ok<DutyMorningItem[]>(await client.rpc("run_duty_morning", { p_secret: secret }));
    },

    async tgRespondSwap(secret, tgUserId, requestId, accept) {
      return ok<TgSwapResult>(
        await client.rpc("tg_respond_swap", { p_secret: secret, p_tg_user_id: tgUserId, p_request: requestId, p_accept: accept }),
      );
    },

    async listDutyEvents(dutyId) {
      const { data, error } = await client
        .from("duty_events")
        .select("id, duty_id, kind, user_id, partner_id, liters, purchase_id, created_at")
        .eq("duty_id", dutyId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw mapDbError(error);
      return (data ?? []) as DutyEvent[];
    },

    async dutyDoneEvent(dutyId) {
      return ok<DutyEvent>(await client.rpc("duty_done_event", { p_duty: dutyId }));
    },

    async dutyPing(dutyId) {
      return ok<DutyEvent>(await client.rpc("duty_ping", { p_duty: dutyId }));
    },

    async waterEmpty(dutyId) {
      return ok<DutyEvent>(await client.rpc("water_empty", { p_duty: dutyId }));
    },

    async waterBrought(dutyId, partnerId, payerId = null) {
      return ok<DutyEvent>(await client.rpc("water_brought", { p_duty: dutyId, p_partner: partnerId, p_payer: payerId }));
    },

    async waterBottleUsed(dutyId) {
      return withOrder(ok<DutyRow>(await client.rpc("water_bottle_used", { p_duty: dutyId })));
    },

    async setWaterPrice(dutyId, price) {
      return withOrder(ok<DutyRow>(await client.rpc("set_water_price", { p_duty: dutyId, p_price: price })));
    },

    async dutyEventNotice(secret, eventId) {
      return ok<DutyEventNotice>(await client.rpc("duty_event_notice", { p_secret: secret, p_event: eventId }));
    },
  };
}
