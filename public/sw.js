self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

self.addEventListener('push', (event) => {
  const data = event.data.json();
  const options = {
    body: data.body,
    icon: data.icon || 'https://picsum.photos/seed/fotofarma/192/192',
    badge: data.icon || 'https://picsum.photos/seed/fotofarma/192/192',
    vibrate: [100, 50, 100],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: '2'
    },
    actions: [
      {action: 'take', title: 'Tomada ✅'},
      {action: 'close', title: 'Cerrar'}
    ]
  };
  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'take') {
    // Aquí se podría añadir lógica para marcar como completada
  } else {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});
