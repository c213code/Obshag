import { describe, expect, it } from "vitest";
import { urlBase64ToUint8Array } from "./pwa";

describe("urlBase64ToUint8Array", () => {
  it("decodes base64url without padding", () => {
    expect(Array.from(urlBase64ToUint8Array("AQID"))).toEqual([1, 2, 3]);
    expect(Array.from(urlBase64ToUint8Array("-_8"))).toEqual([251, 255]);
  });
});
