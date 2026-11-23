"use strict";
// Notification-only worker: no fetch interception, cache, push subscriptions,
// analytics, or autonomous scheduling.
self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const scope = self.registration.scope;
    const pages = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = pages.find(item => item.url.startsWith(scope));
    if (page) await page.focus();
    else if (self.clients.openWindow) await self.clients.openWindow(scope);
  })());
});
