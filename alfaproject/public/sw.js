self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Handle push events from a future server-side push service
self.addEventListener('push', e => {
  const data = e.data?.json() || {};
  e.waitUntil(
    self.registration.showNotification(data.title || 'Insyte Studio', {
      body: data.body || "What are you wearing today? Log your outfit now.",
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: data.tag || 'daily-reminder',
      data: { url: '/' },
      actions: [
        { action: 'log', title: 'Log Outfit' },
        { action: 'skip', title: 'Later' }
      ]
    })
  );
});

// Open the app when user taps the notification
self.addEventListener('notificationclick', e => {
  e.notification.close();
  if (e.action === 'skip') return;
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if ('focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
