/**
 * Content-Security-Policy for the web deploy (app.indiflight.org). Emitted as a <meta> tag by the Vite plugin below
 * when INDIFLIGHT_CSP=1 (set in .github/workflows/deploy-web.yml). Tauri and Capacitor builds load from other origins
 * and talk to their native side, so they don't get it.
 *
 * The protection that matters is script-src without 'unsafe-inline' or 'unsafe-eval': text that reaches an HTML sink
 * (a log name, a parser bug) cannot run script. connect-src cannot stop data leaving, because the FC bridge connects to
 * any wss:// host the user enters.
 *
 * Adding a network endpoint means adding its origin here; the browser console reports blocked requests as CSP
 * violations.
 */

const LOCALHOST = ["http://127.0.0.1:*", "http://localhost:*"];

export const cspDirectives = {
    "default-src": ["'self'"],
    "script-src": ["'self'"],
    // Vue and @nuxt/ui set inline styles. Injected CSS cannot run script.
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": [
        "'self'",
        "data:",
        "blob:",
        "https://tile.openstreetmap.org", // OpenLayers OSM layer, blackbox viewer map
        "https://mt1.google.com", // satellite / hybrid map layers
    ],
    "font-src": ["'self'", "data:"],
    "connect-src": [
        "'self'",
        "data:",
        "blob:",
        "https://services.swpc.noaa.gov", // Pre-Flight: Kp index
        "https://api.open-meteo.com", // Pre-Flight: weather, elevation
        "https://ipapi.co", // IP geolocation fallback
        "https://get.geojs.io", // Flight Plan: IP geolocation
        "https://api.open-elevation.com", // Flight Plan: elevation profile
        "https://external-api.faa.gov", // NOTAMs
        "https://api.core.openaip.net", // airspaces
        // UIcon fetches icons missing from the bundled Lucide set (e.g. names built at runtime) as SVG data.
        "https://api.iconify.design",
        "https://api.simplesvg.com",
        "https://api.unisvg.com",
        // Log database (Log Download tab): a server the user enters.
        "https:",
        // Local build / simulation daemon. Plain http only works for loopback from an https page anyway.
        ...LOCALHOST,
        // FC over WebSocket: SITL on loopback, or a TLS bridge on any host the user enters.
        "ws://127.0.0.1:*",
        "ws://localhost:*",
        "wss:",
    ],
    "frame-src": LOCALHOST, // simulation visualization, served next to the daemon
    "worker-src": ["'self'", "blob:"],
    "media-src": ["'self'", "blob:"], // blackbox viewer: user-picked flight video
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'none'"],
};

export function cspString(directives = cspDirectives) {
    return Object.entries(directives)
        .map(([name, values]) => `${name} ${values.join(" ")}`)
        .join("; ");
}

/** Vite plugin: put the policy first in <head> of every HTML entry, in builds with INDIFLIGHT_CSP=1. */
export function cspPlugin() {
    return {
        name: "indiflight-csp",
        apply: "build",
        transformIndexHtml() {
            if (process.env.INDIFLIGHT_CSP !== "1") {
                return [];
            }
            return [
                {
                    tag: "meta",
                    attrs: { "http-equiv": "Content-Security-Policy", content: cspString() },
                    injectTo: "head-prepend",
                },
            ];
        },
    };
}
