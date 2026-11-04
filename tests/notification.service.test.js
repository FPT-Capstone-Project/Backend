const test = require('node:test');
const assert = require('node:assert/strict');

function loadService({
  recipient = { session_id: 4, user_id: 8, role_id: 3, status: 'CULTIVATING', user_status: 'ACTIVE' },
  notification = { notification_id: 10 },
} = {}) {
  const modelPath = require.resolve('../src/models/notification.model');
  const servicePath = require.resolve('../src/services/notification.service');
  const calls = [];

  delete require.cache[modelPath];
  delete require.cache[servicePath];
  require.cache[modelPath] = {
    exports: {
      findSessionRecipient: async (...args) => {
        calls.push({ method: 'findSessionRecipient', args });
        return recipient;
      },
      createForSession: async (...args) => {
        calls.push({ method: 'createForSession', args });
        return notification;
      },
      findAllByUserId: async (...args) => {
        calls.push({ method: 'findAllByUserId', args });
        return { notifications: [], total: 3, unreadCount: 5 };
      },
      markAsReadById: async (...args) => {
        calls.push({ method: 'markAsReadById', args });
        return { notification_id: 5, is_read: true };
      },
      markAllAsReadByUserId: async (...args) => {
        calls.push({ method: 'markAllAsReadByUserId', args });
        return 2;
      },
    },
  };

  return { service: require('../src/services/notification.service'), calls };
}

test('validates and sends a cultivation session notification with the operator ID', async () => {
  const { service, calls } = loadService();

  const result = await service.sendCultivationSessionNotification('4', {
    message: ' Cultivation update ',
    title: ' Farm alert ',
    type: 'mushroom_disease',
  }, '2');

  assert.deepEqual(result, { notification_id: 10 });
  assert.deepEqual(calls, [
    { method: 'findSessionRecipient', args: [4] },
    {
      method: 'createForSession',
      args: [{
        sessionId: 4,
        userId: 8,
        message: 'Cultivation update',
        title: 'Farm alert',
        type: 'MUSHROOM_DISEASE',
        createdBy: 2,
      }],
    },
  ]);

  await assert.rejects(
    () => service.sendCultivationSessionNotification(4, { title: 'Update', message: '   ' }, 2),
    { statusCode: 400, message: 'message is required' },
  );
  await assert.rejects(
    () => service.sendCultivationSessionNotification(4, { title: 'Update', message: 'x'.repeat(1001) }, 2),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.sendCultivationSessionNotification(4, { title: 'Update', message: 'Update', type: 'UNKNOWN' }, 2),
    { statusCode: 400 },
  );
  await assert.rejects(
    () => service.sendCultivationSessionNotification(0, { title: 'Update', message: 'Update' }, 2),
    { statusCode: 400 },
  );
});

test('rejects missing, closed, and inactive session recipients', async () => {
  await assert.rejects(
    () => loadService({ recipient: null }).service.sendCultivationSessionNotification(4, { title: 'Update', message: 'Update' }, 2),
    { statusCode: 404, message: 'Cultivation session not found' },
  );
  await assert.rejects(
    () => loadService({ recipient: { user_id: 8, role_id: 3, status: 'COMPLETED', user_status: 'ACTIVE' } })
      .service.sendCultivationSessionNotification(4, { title: 'Update', message: 'Update' }, 2),
    { statusCode: 409, message: 'Cannot send notifications for a completed or cancelled session' },
  );
  await assert.rejects(
    () => loadService({ recipient: { user_id: 8, role_id: 3, status: 'CULTIVATING', user_status: 'BLOCKED' } })
      .service.sendCultivationSessionNotification(4, { title: 'Update', message: 'Update' }, 2),
    { statusCode: 409, message: 'Recipient account is not active' },
  );
});

test('requires valid title, message, type, and session ID before looking up a recipient', async () => {
  const { service, calls } = loadService();
  for (const payload of [null, [], {}, { message: 'Update' },
    { title: '', message: 'Update' }, { title: '   ', message: 'Update' },
    { title: 123, message: 'Update' }, { title: 'x'.repeat(101), message: 'Update' },
    { title: 'Update' }, { title: 'Update', message: 123 },
    { title: 'Update', message: 'Update', type: null }]) {
    await assert.rejects(() => service.sendCultivationSessionNotification(4, payload, 2), { statusCode: 400 });
  }
  for (const id of ['abc', -1, 1.5, '9007199254740992']) {
    await assert.rejects(() => service.sendCultivationSessionNotification(id, { title: 'Update', message: 'Update' }, 2), { statusCode: 400 });
  }
  assert.deepEqual(calls, []);
});

test('rejects absent or non-Customer owners and cancelled sessions', async () => {
  for (const owner of [{ user_id: null, role_id: null }, { user_id: 8, role_id: 2 }]) {
    const { service, calls } = loadService({ recipient: { ...owner, status: 'CULTIVATING', user_status: 'ACTIVE' } });
    await assert.rejects(() => service.sendCultivationSessionNotification(4, { title: 'Update', message: 'Update' }, 2), { statusCode: 404 });
    assert.equal(calls.length, 1);
  }
  const { service } = loadService({ recipient: { user_id: 8, role_id: 3, status: 'CANCELLED', user_status: 'ACTIVE' } });
  await assert.rejects(() => service.sendCultivationSessionNotification(4, { title: 'Update', message: 'Update' }, 2), { statusCode: 409 });
});

test('defaults the type and ignores caller-supplied recipient, creator, and reference fields', async () => {
  const { service, calls } = loadService();
  await service.sendCultivationSessionNotification(4, {
    title: 'Update', message: 'Update', userId: 999, createdBy: 999,
    referenceType: 'OTHER', referenceId: 999,
  }, 2);
  assert.deepEqual(calls[1].args[0], {
    sessionId: 4, userId: 8, createdBy: 2, title: 'Update', message: 'Update', type: 'OPERATOR_MESSAGE',
  });
});

test('filters and paginates only the authenticated user notifications', async () => {
  const { service, calls } = loadService();

  const result = await service.getNotifications('7', {
    isRead: 'false', page: '2', pageSize: '2', userId: '999',
  });

  assert.deepEqual(calls[0], {
    method: 'findAllByUserId',
    args: [{ userId: 7, isRead: false, limit: 2, offset: 2 }],
  });
  assert.deepEqual(result, {
    notifications: [],
    pagination: { page: 2, pageSize: 2, total: 3, totalPages: 2 },
    unreadCount: 5,
  });
  await assert.rejects(() => service.getNotifications(7, { isRead: 'yes' }), { statusCode: 400 });
  await assert.rejects(() => service.getNotifications(7, { page: '0' }), { statusCode: 400 });
  await assert.rejects(() => service.getNotifications(7, { pageSize: '101' }), { statusCode: 400 });
});

test('uses the authenticated user ID for read operations', async () => {
  const { service, calls } = loadService();

  await service.markNotificationAsRead('7', '5');
  const result = await service.markAllNotificationsAsRead('7');

  assert.deepEqual(calls, [
    { method: 'markAsReadById', args: [7, 5] },
    { method: 'markAllAsReadByUserId', args: [7] },
  ]);
  assert.deepEqual(result, { updated: 2 });
});
