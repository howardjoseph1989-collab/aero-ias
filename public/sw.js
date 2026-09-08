/* AERO IAS installability worker. Does not cache the Cesium globe or API
   proxies — those stay network-first so a stale service worker cannot strand
   live layers. This file exists so mobile browsers can Add to Home Screen. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
