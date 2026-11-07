import { describe, expect, it } from "vitest";
import { decidePushStatus, type PushEnv } from "./pushState";

const base: PushEnv = { ios: true, standalone: true, hasPushApi: true, vapidKey: "k", permission: "default", subscribed: false };

describe("decidePushStatus", () => {
  it("iOS outside the Home Screen app: add it to the Home Screen first (whatever else is true)", () => {
    expect(decidePushStatus({ ...base, standalone: false })).toBe("needs_home_screen");
    expect(decidePushStatus({ ...base, standalone: false, hasPushApi: false, permission: "unsupported" })).toBe("needs_home_screen");
  });
  it("no push API: unsupported", () => {
    expect(decidePushStatus({ ...base, hasPushApi: false })).toBe("unsupported");
    expect(decidePushStatus({ ...base, ios: false, permission: "unsupported" })).toBe("unsupported");
  });
  it("denied beats everything else once the app can ask", () => {
    expect(decidePushStatus({ ...base, permission: "denied", subscribed: true })).toBe("denied");
  });
  it("without a VAPID key push cannot be enabled", () => {
    expect(decidePushStatus({ ...base, vapidKey: undefined })).toBe("not_configured");
  });
  it("granted and subscribed is on; granted without a subscription (or default) is off", () => {
    expect(decidePushStatus({ ...base, permission: "granted", subscribed: true })).toBe("on");
    expect(decidePushStatus({ ...base, permission: "granted", subscribed: false })).toBe("off");
    expect(decidePushStatus(base)).toBe("off");
  });
  it("works outside iOS too", () => {
    expect(decidePushStatus({ ...base, ios: false, standalone: false, permission: "granted", subscribed: true })).toBe("on");
  });
});
