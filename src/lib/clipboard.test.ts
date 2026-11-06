import { afterEach, describe, expect, it, vi } from "vitest";
import { KASPI_TRANSFERS_URL, copyText } from "./clipboard";

afterEach(() => vi.unstubAllGlobals());

function fakeDocument(execResult: boolean | Error) {
  const area = { value: "", style: {} as Record<string, string>, setAttribute: vi.fn(), select: vi.fn(), remove: vi.fn() };
  const doc = {
    createElement: vi.fn(() => area),
    body: { appendChild: vi.fn() },
    execCommand: vi.fn(() => {
      if (execResult instanceof Error) throw execResult;
      return execResult;
    }),
  };
  return { doc, area };
}

describe("copyText", () => {
  it("copies synchronously through the textarea first (inside the user gesture) and never touches the async API then", async () => {
    const { doc, area } = fakeDocument(true);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const pending = copyText("+77010000002");
    // the textarea path already ran before the first await
    expect(doc.execCommand).toHaveBeenCalledWith("copy");
    expect(area.value).toBe("+77010000002");
    expect(area.remove).toHaveBeenCalled();
    expect(await pending).toBe(true);
    expect(writeText).not.toHaveBeenCalled();
  });

  it("falls back to the async Clipboard API when the textarea path fails", async () => {
    vi.stubGlobal("document", fakeDocument(false).doc);
    const writeText = vi.fn(async () => undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    expect(await copyText("abc")).toBe(true);
    expect(writeText).toHaveBeenCalledWith("abc");
    vi.stubGlobal("document", fakeDocument(new Error("blocked")).doc);
    expect(await copyText("abc")).toBe(true);
  });

  it("resolves false (never throws) when every path fails", async () => {
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", fakeDocument(false).doc);
    expect(await copyText("x")).toBe(false);
    vi.stubGlobal("document", fakeDocument(new Error("blocked")).doc);
    expect(await copyText("x")).toBe(false);
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error("denied"))) } });
    expect(await copyText("x")).toBe(false);
  });

  it("only ever opens the verified Kaspi transfers URL, without query params", () => {
    expect(KASPI_TRANSFERS_URL).toBe("https://kaspi.kz/transfers");
  });
});
