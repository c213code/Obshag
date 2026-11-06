import { describe, expect, it } from "vitest";
import type { UserNet } from "./netting";
import { listRedirect, pairScreenState } from "./settleNav";

const cp = (userId: string, active = true) => ({ userId, iOwe: 100, theyOwe: 0, net: 100, direction: "i_pay" as const, active });
const net = (...counterparties: ReturnType<typeof cp>[]): UserNet => ({ counterparties, owe: 0, owed: 0, total: 0 });
const present = (...ids: string[]) => (id: string) => ids.includes(id);

describe("listRedirect", () => {
  it("sends the user to the one neighbour they settle with", () => {
    expect(listRedirect(net(cp("a")), present("a"))).toBe("a");
  });

  it("does nothing with several counterparties or none", () => {
    expect(listRedirect(net(cp("a"), cp("b")), present("a", "b"))).toBeNull();
    expect(listRedirect(net(), present())).toBeNull();
  });

  it("never redirects to a neighbour who left (no loop with their screen)", () => {
    expect(listRedirect(net(cp("gone", false)), present())).toBeNull();
    expect(listRedirect(net(cp("a"), cp("gone", false)), present("a"))).toBeNull();
  });
});

describe("pairScreenState", () => {
  it("is ready for a present neighbour", () => {
    expect(pairScreenState("a", "me", net(cp("a")), present("a"))).toBe("ready");
    expect(pairScreenState("a", "me", net(), present("a"))).toBe("ready"); // even: the screen shows «Все в расчёте»
  });

  it("shows the departed state for a neighbour who left with a debt, instead of bouncing to the list", () => {
    expect(pairScreenState("gone", "me", net(cp("gone", false)), present())).toBe("departed");
  });

  it("an unknown person, or yourself, goes back to the list", () => {
    expect(pairScreenState("x", "me", net(cp("a")), present("a"))).toBe("unknown");
    expect(pairScreenState("me", "me", net(), present("me"))).toBe("unknown");
  });

  it("the sole-departed-counterparty round trip cannot loop: list stays, pair screen stays", () => {
    const n = net(cp("gone", false));
    expect(listRedirect(n, present())).toBeNull();
    expect(pairScreenState("gone", "me", n, present())).toBe("departed");
  });
});
