import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./pushEndpoint";

describe("isAllowedPushEndpoint", () => {
  it("accepts the push services", () => {
    for (const u of ["https://web.push.apple.com/Q", "https://fcm.googleapis.com/fcm/send/a", "https://updates.push.services.mozilla.com/w", "https://db5p.notify.windows.com/w"])
      expect(isAllowedPushEndpoint(u)).toBe(true);
  });
  it("rejects everything else", () => {
    for (const u of ["https://evil.example/x", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.io/x", "https://u:p@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://169.254.169.254/", "nope"])
      expect(isAllowedPushEndpoint(u)).toBe(false);
  });
});
