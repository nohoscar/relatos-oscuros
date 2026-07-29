// ============================================
// Relatos Oscuros - Service Worker
// Sube este número al cambiar el app shell para forzar actualización
// ============================================
const VERSION = "v2";
const SHELL_CACHE = `relatos-shell-${VERSION}`;
const RUNTIME_CACHE = `relatos-runtime-${VERSION}`;

// Archivos base de la app (se precachean al instalar)
const APP_SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
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
          .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      );
    })()
  );
});

// Permitir que la página fuerce la actualización
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Estrategias de fetch
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // solo mismo origen

  // Peticiones con Range (audio al buscar): ir directo a la red, sin cachear
  if (req.headers.has("range")) {
    event.respondWith(fetch(req));
    return;
  }

  // Navegación: red primero, con index.html como respaldo offline
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() => caches.match("index.html"))
    );
    return;
  }

  // stories.json: red primero (para ver historias nuevas), caché de respaldo
  if (url.pathname.endsWith("stories.json")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // Audio, imágenes, css, js: caché primero, y se guarda al vuelo
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.status === 200 && res.type === "basic") {
          const copy = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    })
  );
});
