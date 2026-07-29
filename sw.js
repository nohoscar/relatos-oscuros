// ============================================
// Relatos Oscuros - Service Worker
// Sube este número al cambiar el app shell para forzar actualización
// ============================================
const VERSION = "v9";
const SHELL_CACHE = `relatos-shell-${VERSION}`;
const RUNTIME_CACHE = `relatos-runtime-${VERSION}`;
// Caché de descarga manual (sin versión: sobrevive a las actualizaciones)
const OFFLINE_CACHE = "relatos-offline";

// Archivos base de la app (se precachean al instalar)
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "stories.json",
  "images/icon-192.png",
  "images/icon-512.png",
  "images/apple-touch-icon.png",
  "audio/ambient-menu.mp3",
];

// Instalar: precachear el app shell
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL))
  );
});

// Activar: borrar cachés de versiones viejas
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE && k !== OFFLINE_CACHE)
          .map((k) => caches.delete(k))
      );
      // Tomar control de la página de inmediato (offline funciona desde la 1a visita)
      await self.clients.claim();
    })()
  );
});

// Descargar todos los recursos para uso sin conexión
async function downloadAll(urls, client) {
  const cache = await caches.open(OFFLINE_CACHE);
  const total = urls.length;
  let done = 0;
  let failed = 0;
  for (const url of urls) {
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const res = await fetch(url, { cache: "no-store" });
        if (res && res.status === 200) await cache.put(url, res.clone());
        else failed++;
      }
    } catch (e) {
      failed++;
    }
    done++;
    if (client) client.postMessage({ type: "offline-progress", done, total });
  }
  if (client) client.postMessage({ type: "offline-done", total, failed });
}

async function clearOffline(client) {
  await caches.delete(OFFLINE_CACHE);
  if (client) client.postMessage({ type: "offline-cleared" });
}

async function checkOffline(client) {
  let count = 0;
  if (await caches.has(OFFLINE_CACHE)) {
    const c = await caches.open(OFFLINE_CACHE);
    count = (await c.keys()).length;
  }
  if (client) client.postMessage({ type: "offline-status", count });
}

// Mensajes desde la página
self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "SKIP_WAITING") { self.skipWaiting(); return; }
  if (data.type === "DOWNLOAD_ALL") { event.waitUntil(downloadAll(data.urls || [], event.source)); return; }
  if (data.type === "CLEAR_OFFLINE") { event.waitUntil(clearOffline(event.source)); return; }
  if (data.type === "CHECK_OFFLINE") { event.waitUntil(checkOffline(event.source)); return; }
});

// Red primero: siempre la última versión si hay conexión; caché de respaldo offline
async function networkFirst(req) {
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === "basic") {
      const copy = res.clone();
      caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
    }
    return res;
  } catch (err) {
    const cached = await caches.match(req);
    if (cached) return cached;
    throw err;
  }
}

// Caché primero: para recursos que no cambian (audio, imágenes).
// Sirve la copia guardada aunque la petición traiga Range (así reproduce offline).
async function cacheFirst(req) {
  const cached = await caches.match(req, { ignoreVary: true });
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200 && res.type === "basic") {
      const copy = res.clone();
      caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
    }
    return res;
  } catch (err) {
    // Offline y no está en caché
    return new Response("", { status: 504, statusText: "Sin conexión" });
  }
}

// Estrategias de fetch
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // solo mismo origen

  const p = url.pathname.toLowerCase();
  const isMedia = /\.(mp3|png|jpe?g|webp|gif|svg|ico)$/.test(p);

  // Navegación: red primero, con index.html como respaldo offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("index.html"))
    );
    return;
  }

  // Audio e imágenes: caché primero (no cambian). Resto (js, css, json): red primero.
  event.respondWith(isMedia ? cacheFirst(req) : networkFirst(req));
});
