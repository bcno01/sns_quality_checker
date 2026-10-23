const CACHE_VERSION = "v7";
const SHELL_CACHE = `sns-quality-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `sns-quality-runtime-${CACHE_VERSION}`;

const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/style.css",
  "./src/main.js",
  "./src/presets.js",
  "./src/diagnostics.js",
  "./src/imagePipeline.js",
  "./src/videoPipeline.js",
  "./src/progress.js",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./vendor/ffmpeg/index.js",
  "./vendor/ffmpeg/classes.js",
  "./vendor/ffmpeg/const.js",
  "./vendor/ffmpeg/errors.js",
  "./vendor/ffmpeg/types.js",
  "./vendor/ffmpeg/utils.js",
  "./vendor/ffmpeg/worker.js",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_FILES)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isCdnRequest(url) {
  return url.origin === "https://unpkg.com";
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // ffmpeg.wasm本体などCDNリソースはCache First（初回DL後はオフラインでも再利用）
  if (isCdnRequest(url)) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // 同一オリジンのアプリシェルはCache First、それ以外はネットワーク優先
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
});
