/* Общак: what the service worker may cache (slice 8). Pure functions, loaded by sw.js via importScripts and by the unit tests.
 * The rule that matters: nothing private is ever stored. API, auth, RSC, cross-origin, non-GET and no-store/private responses are bypassed. */
(function (root) {
  var OFFLINE_URL = "/offline";
  var STATIC_RE = /^\/(?:_next\/static\/|icons\/)/;
  var FONT_RE = /\.(?:woff2?|ttf|otf)$/i;
  var MANIFEST = "/manifest.webmanifest";

  function header(request, name) {
    var h = request && request.headers;
    if (!h) return null;
    if (typeof h.get === "function") return h.get(name);
    var key = Object.keys(h).filter(function (k) { return k.toLowerCase() === name.toLowerCase(); })[0];
    return key ? h[key] : null;
  }

  /** "bypass" (never touch), "cache-first" (immutable static), "network-first" (HTML navigation, offline fallback only). */
  function strategyFor(request, origin) {
    if (!request || !request.url) return "bypass";
    if (String(request.method || "GET").toUpperCase() !== "GET") return "bypass";
    var url;
    try { url = new URL(request.url); } catch { return "bypass"; }
    if (url.origin !== origin) return "bypass";
    if (url.pathname === "/api" || url.pathname.indexOf("/api/") === 0) return "bypass";
    if (header(request, "authorization")) return "bypass";
    if (url.searchParams.has("_rsc") || header(request, "rsc") !== null) return "bypass";
    if (STATIC_RE.test(url.pathname) || FONT_RE.test(url.pathname) || url.pathname === MANIFEST) return "cache-first";
    if (request.mode === "navigate") return "network-first";
    return "bypass";
  }

  /** May this response be stored? Only successful, public, same-origin immutable assets; HTML navigations are never stored. */
  function shouldCache(request, origin, response) {
    if (strategyFor(request, origin) !== "cache-first") return false;
    if (!response || response.status !== 200 || response.type === "opaque" || response.type === "opaqueredirect") return false;
    if (response.redirected) return false;
    var cc = String((response.headers && response.headers.get && response.headers.get("cache-control")) || "").toLowerCase();
    if (/no-store|private/.test(cc)) return false;
    var vary = response.headers && response.headers.get && response.headers.get("vary");
    if (vary && /\*/.test(vary)) return false;
    return true;
  }

  var api = { OFFLINE_URL: OFFLINE_URL, strategyFor: strategyFor, shouldCache: shouldCache };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.swRules = api;
})(typeof self !== "undefined" ? self : this);
