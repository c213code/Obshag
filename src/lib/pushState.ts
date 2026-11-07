export type PushStatus =
  | "unsupported" // no service worker / push in this browser
  | "needs_home_screen" // iOS only delivers push to an installed Home Screen app
  | "not_configured" // no VAPID public key in this build
  | "denied"
  | "off"
  | "on";

export type PushEnv = {
  ios: boolean;
  standalone: boolean;
  hasPushApi: boolean;
  vapidKey: string | undefined;
  permission: NotificationPermission | "unsupported";
  subscribed: boolean;
};

/** Which state the «Включить уведомления» pill is in. Order matters: iOS in Safari cannot even ask for permission. */
export function decidePushStatus(e: PushEnv): PushStatus {
  if (e.ios && !e.standalone) return "needs_home_screen";
  if (!e.hasPushApi || e.permission === "unsupported") return "unsupported";
  if (e.permission === "denied") return "denied";
  if (!e.vapidKey) return "not_configured";
  return e.permission === "granted" && e.subscribed ? "on" : "off";
}
