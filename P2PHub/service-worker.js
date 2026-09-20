// Кеширование отключено — SW только для push-уведомлений

self.addEventListener("push", (event) => {
  let data = { title: "⚠️ ПИЗДЕЦ!", body: "Кто-то нажал кнопку", icon: "./icons/icon-192.png" };
  try { data = { ...data, ...event.data.json() }; } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: data.icon,
      badge: data.icon,
      vibrate: [200, 100, 200],
      tag: "pizdets",
      renotify: true,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow("/"));
});
