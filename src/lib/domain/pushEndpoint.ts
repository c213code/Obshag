/** Push endpoints are fetched by OUR server with a VAPID JWT, so only the real push services are allowed (S1). */
const HOSTS = ["web.push.apple.com", "fcm.googleapis.com", "updates.push.services.mozilla.com"];

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  return HOSTS.includes(host) || /^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
}
