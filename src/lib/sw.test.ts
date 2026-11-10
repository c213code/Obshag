import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

type Handler = (event: unknown) => void;

/** Runs public/sw.js against a fake service-worker scope and returns what it did. */
function load(extra: Record<string, unknown> = {}) {
  const handlers: Record<string, Handler> = {};
  const shown: Array<{ title: string; options: Record<string, unknown> }> = [];
  const opened: string[] = [];
  const navigated: string[] = [];
  let focused = 0;
  const clientsList: Array<{ url: string; focus: () => Promise<unknown>; navigate?: (u: string) => Promise<unknown> }> = [];
  const self = {
    location: { origin: "https://obshak.test" },
    addEventListener: (type: string, fn: Handler) => (handlers[type] = fn),
    skipWaiting: () => undefined,
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(clientsList),
      openWindow: (u: string) => {
        opened.push(u);
        return Promise.resolve(null);
      },
    },
  };
  const rules = readFileSync(join(process.cwd(), "public/sw-rules.js"), "utf8");
  const importScripts = () => vm.runInContext(rules, ctx);
  const ctx = vm.createContext({ self, URL, Number, String, Math, encodeURIComponent, importScripts, Object, Promise, Set, Headers, setTimeout, ...extra });
  vm.runInContext(readFileSync(join(process.cwd(), "public/sw.js"), "utf8"), ctx);
  const wait = async (fn: Handler, event: Record<string, unknown>) => {
    let p: Promise<unknown> = Promise.resolve();
    fn({ ...event, waitUntil: (x: Promise<unknown>) => (p = x) });
    await p;
  };
  return { self: self as typeof self & { registration: { pushManager?: unknown } }, handlers, shown, opened, navigated, clientsList, focus: () => focused, wait, bumpFocus: () => focused++ };
}

const pushEvent = (data: unknown) => ({ data: { json: () => data } });
const click = (action: string, data: unknown) => ({ action, notification: { data, close: () => undefined } });

describe("sw.js", () => {
  it("push: shows «Magnum · 6 000 ₸» with the two actions and a /pending url", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "pending", purchaseId: "abc", merchant: "Magnum", amount: 6000 }));
    expect(sw.shown).toHaveLength(1);
    expect(sw.shown[0].title).toBe("Magnum · 6 000 ₸");
    expect(sw.shown[0].options).toMatchObject({
      body: "Что купил? Общее или моё",
      actions: [
        { action: "shared", title: "Общее" },
        { action: "personal", title: "Моё" },
      ],
      data: { purchaseId: "abc", url: "/pending/abc" },
      tag: "pending-abc",
    });
  });

  it("push: a variable bill shows «Коммуналка: введи сумму за ноябрь» and opens /monthly", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "bill", billId: "b1", title: "Коммуналка", month: "ноябрь" }));
    expect(sw.shown[0].title).toBe("Коммуналка: введи сумму за ноябрь");
    expect(sw.shown[0].options).toMatchObject({ tag: "bill-b1", data: { url: "/monthly" } });
    await sw.wait(sw.handlers.notificationclick, click("", sw.shown[0].options.data));
    expect(sw.opened).toEqual(["/monthly"]);
  });

  it("push: the 19:00 digest shows «Ждут решения: N покупок» once and opens /", async () => {
    for (const [n, word] of [[1, "1 покупка"], [2, "2 покупки"], [5, "5 покупок"], [11, "11 покупок"], [22, "22 покупки"]] as const) {
      const sw = load();
      await sw.wait(sw.handlers.push, pushEvent({ type: "digest", count: n }));
      expect(sw.shown).toHaveLength(1);
      expect(sw.shown[0].title).toBe(`Ждут решения: ${word}`);
      expect(sw.shown[0].options).toMatchObject({ body: "Общее или моё? Открой Общак", data: { url: "/" } });
      expect(sw.shown[0].options).not.toHaveProperty("actions");
    }
  });

  it("push: a reminder shows «Ты должен Айдосу 200 ₸» · «Рассчитаться» and opens /settle/<creditor>", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "reminder", fromUserId: "u1", fromName: "Айдосу", amount: 200 }));
    expect(sw.shown[0].title).toBe("Ты должен Айдосу 200\u00a0₸");
    expect(sw.shown[0].options).toMatchObject({ body: "Рассчитаться", tag: "reminder-u1", data: { url: "/settle/u1" } });
    expect(sw.shown[0].options.actions).toBeUndefined();
    // tapping it opens the settlement
    await sw.wait(sw.handlers.notificationclick, click("", sw.shown[0].options.data));
    expect(sw.opened).toEqual(["/settle/u1"]);
  });

  it("push: «Сегодня готовишь ты 🍳» at 09:00 opens /duty", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "duty-today", kind: "cooking", title: "Готовка" }));
    expect(sw.shown[0].title).toBe("Сегодня готовишь ты 🍳");
    expect(sw.shown[0].options).toMatchObject({ tag: "duty-today", data: { url: "/duty" } });
    await sw.wait(sw.handlers.push, pushEvent({ type: "duty-today", kind: "trash", title: "Мусор" }));
    expect(sw.shown[1].title).toBe("Мусор: сегодня твоя очередь");
  });

  it("push: «Пакет полный» and «Вода кончилась» open that queue", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "duty-event", kind: "ping", name: "Парасат", title: "Мусор" }));
    expect(sw.shown[0].title).toBe("🗑 Пакет полный");
    expect(sw.shown[0].options).toMatchObject({ data: { url: "/duty?kind=trash" } });
    await sw.wait(sw.handlers.push, pushEvent({ type: "duty-event", kind: "empty", name: "Парасат", title: "Вода" }));
    expect(sw.shown[1].title).toBe("💧 Вода кончилась");
    expect(sw.shown[1].options).toMatchObject({ data: { url: "/duty?kind=water" } });
  });

  it("push: a swap request and a decline open the request screen", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "swap-request", requestId: "r1", name: "Ерасыл", fromLabel: "пн 17", toLabel: "вт 18" }));
    expect(sw.shown[0].title).toBe("Ерасыл просит поменяться");
    expect(sw.shown[0].options).toMatchObject({ body: "пн 17 ⇄ вт 18 · ответь до 10:00", tag: "swap-r1", data: { url: "/duty/request/r1" } });
    await sw.wait(sw.handlers.push, pushEvent({ type: "swap-declined", requestId: "r1", name: "Айдос", fromLabel: "пн 17", toLabel: "вт 18" }));
    expect(sw.shown[1].title).toBe("Айдос не может поменяться");
  });

  it("push: no merchant falls back to «Покупка Apple Pay»", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "pending", purchaseId: "x", merchant: null, amount: 250 }));
    expect(sw.shown[0].title).toBe("Покупка Apple Pay · 250 ₸");
  });

  it("push: ALWAYS shows a notification, a generic one for unknown or malformed payloads", async () => {
    const sw = load();
    await sw.wait(sw.handlers.push, pushEvent({ type: "other" }));
    await sw.wait(sw.handlers.push, pushEvent(null));
    await sw.wait(sw.handlers.push, { data: { json: () => { throw new Error("bad json"); } } });
    await sw.wait(sw.handlers.push, {});
    expect(sw.shown).toHaveLength(4);
    for (const n of sw.shown) {
      expect(n.title).toBe("Общак");
      expect(n.options).toMatchObject({ body: "Новая покупка", data: { url: "/" } });
    }
  });

  it("click: when focus fails the app is opened in a new window", async () => {
    const sw = load();
    sw.clientsList.push({ url: "https://obshak.test/", focus: () => Promise.reject(new Error("no")) });
    await sw.wait(sw.handlers.notificationclick, click("shared", { purchaseId: "p1" }));
    expect(sw.opened).toEqual(["/pending/p1?choice=shared"]);
  });

  it("pushsubscriptionchange: resubscribes with the old key and tells the open windows", async () => {
    const sw = load();
    const messages: unknown[] = [];
    sw.clientsList.push({ url: "https://obshak.test/", focus: () => Promise.resolve(), postMessage: (m: unknown) => messages.push(m) } as never);
    const subscribed: unknown[] = [];
    (sw.self.registration as { pushManager?: unknown }).pushManager = { subscribe: (o: unknown) => (subscribed.push(o), Promise.resolve({})) };
    await sw.wait(sw.handlers.pushsubscriptionchange, { oldSubscription: { options: { applicationServerKey: new Uint8Array([1]) } } });
    expect(subscribed).toHaveLength(1);
    expect(messages).toEqual([{ type: "push-resubscribed" }]);
  });

  it("click: an action opens /pending/<id>?choice=…, no action opens /pending/<id>", async () => {
    const sw = load();
    const data = { purchaseId: "p 1" };
    await sw.wait(sw.handlers.notificationclick, click("shared", data));
    await sw.wait(sw.handlers.notificationclick, click("personal", data));
    await sw.wait(sw.handlers.notificationclick, click("", data));
    await sw.wait(sw.handlers.notificationclick, click("evil", data));
    expect(sw.opened).toEqual(["/pending/p%201?choice=shared", "/pending/p%201?choice=personal", "/pending/p%201", "/pending/p%201"]);
  });

  it("click: focuses and navigates an open window of the app instead of opening another", async () => {
    const sw = load();
    const navigated: string[] = [];
    sw.clientsList.push({
      url: "https://obshak.test/flat",
      focus: () => {
        sw.bumpFocus();
        return Promise.resolve();
      },
      navigate: (u) => {
        navigated.push(u);
        return Promise.resolve();
      },
    });
    await sw.wait(sw.handlers.notificationclick, click("shared", { purchaseId: "p1" }));
    expect(sw.focus()).toBe(1);
    expect(navigated).toEqual(["/pending/p1?choice=shared"]);
    expect(sw.opened).toEqual([]);
  });

  it("click without a purchase opens the app root; a fetch handler exists but only for static assets and navigations", async () => {
    const sw = load();
    await sw.wait(sw.handlers.notificationclick, click("shared", {}));
    expect(sw.opened).toEqual(["/"]);
    expect(typeof sw.handlers.fetch).toBe("function");
  });

  describe("navigations", () => {
    const nav = { url: "https://obshak.test/flat", method: "GET", mode: "navigate", headers: new Headers() };
    const respond = async (sw: ReturnType<typeof load>) => {
      let answer: Promise<unknown> | undefined;
      sw.handlers.fetch({ request: nav, respondWith: (p: Promise<unknown>) => (answer = p) });
      return answer;
    };

    it("passes a slow navigation through fetch: no timer, never swapped for /offline", async () => {
      const timers: number[] = [];
      const page = { ok: true, tag: "the page" };
      let release: (v: unknown) => void = () => undefined;
      const slow = new Promise((res) => (release = res));
      const sw = load({ fetch: () => slow, setTimeout: () => timers.push(1), caches: { open: async () => ({ match: async () => ({ tag: "offline" }) }) } });
      const answer = respond(sw);
      await Promise.resolve();
      release(page); // however late it arrives, it is the answer
      expect(await answer).toBe(page);
      expect(timers).toEqual([]);
    });

    it("falls back to the cached offline page only when fetch rejects", async () => {
      const offline = { tag: "offline" };
      const sw = load({
        fetch: () => Promise.reject(new TypeError("network down")),
        caches: { open: async () => ({ match: async (u: string) => (u === "/offline" ? offline : undefined) }) },
      });
      expect(await respond(sw)).toBe(offline);
    });
  });
});
