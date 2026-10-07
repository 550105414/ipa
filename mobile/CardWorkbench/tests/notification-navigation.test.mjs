import assert from 'node:assert/strict';
import test from 'node:test';

import { loadTypeScript } from './helpers/load-typescript.mjs';

async function harness() {
  let response = null;
  let navigationKey = 'ready';
  let effect;
  const routes = [];
  const ref = { current: null };
  let cleared = 0;
  const component = await loadTypeScript('src/components/notification-navigation.tsx', {
    react: { useRef: () => ref, useEffect: (callback) => { effect = callback; } },
    'expo-router': {
      useRootNavigationState: () => ({ key: navigationKey }),
      useRouter: () => ({ push: (route) => routes.push(route) }),
    },
    'expo-notifications': {
      useLastNotificationResponse: () => response,
      clearLastNotificationResponseAsync: async () => { cleared += 1; },
    },
  });
  return {
    routes,
    render(next, key = 'ready') {
      response = next;
      navigationKey = key;
      component.NotificationNavigation();
      effect();
    },
    get cleared() { return cleared; },
  };
}

const notification = (date, source = 'cardworkbench-todo', taskId = '7') => ({
  actionIdentifier: 'default',
  notification: { date, request: {
    identifier: 'cardworkbench-todo-7', content: { data: { source, taskId } },
  } },
});

test('each delivery opens its task once, including later deliveries with the same stable identifier', async () => {
  const app = await harness();
  app.render(notification(1000));
  app.render(notification(1000));
  app.render(null);
  app.render(notification(2000));
  assert.deepEqual(app.routes, [
    { pathname: '/add-task', params: { task: '7' } },
    { pathname: '/add-task', params: { task: '7' } },
  ]);
  assert.equal(app.cleared, 2);
});

test('cold-start response waits for navigation and accepts only known sources and valid task IDs', async () => {
  const app = await harness();
  app.render(notification(1000), null);
  assert.equal(app.routes.length, 0);
  app.render(notification(1000));
  assert.deepEqual(app.routes, [{ pathname: '/add-task', params: { task: '7' } }]);
  const initialCount = app.routes.length;
  app.render(notification(2000, 'unknown', '8'));
  app.render(notification(3000, 'cardworkbench-todo', '/passwords'));
  app.render(notification(4000, 'cardworkbench-todo', '-1'));
  assert.equal(app.routes.length, initialCount);
  app.render(notification(5000, 'cardworkbench-reminder-test'));
  app.render(notification(6000, 'cardworkbench-reminder-test'));
  assert.deepEqual(app.routes.slice(initialCount), ['/plan', '/plan']);
});
