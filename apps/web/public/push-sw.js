// Timer push for the Workbox service worker (imported by sw.js; TECHNICAL_SPECS §12 "Cooking timers"). The `timers`
// function sends data-only FCM web pushes: { kind: "timer", title, body, link, timerId }. Show them, and open (or focus)
// the app at the step when the notification or its "Open" action is tapped.
self.addEventListener("push", (event) => {
  let msg;
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { data: { title: event.data ? event.data.text() : "Timer done" } };
  }
  const d = msg.data || (msg.notification ? { title: msg.notification.title, body: msg.notification.body } : msg);
  const title = d.title || "Timer done";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "Timer done",
      tag: d.timerId ? `timer-${d.timerId}` : "timer",
      renotify: true,
      requireInteraction: true,
      vibrate: [400, 150, 400, 150, 400],
      icon: "/icons/icon-192.png",
      badge: "/icons/favicon-48.png",
      data: { link: d.link || "/" },
      actions: [{ action: "open", title: "Open" }],
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) {
        if ("focus" in c) {
          await c.focus();
          if ("navigate" in c) await c.navigate(link);
          return;
        }
      }
      await self.clients.openWindow(link);
    })(),
  );
});
