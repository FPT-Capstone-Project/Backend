const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');

test('complaint routes validate inputs and enforce authenticated role access', async () => {
  const paths = ['../src/models/user.model', '../src/services/auth.service', '../src/models/complaint.model', '../src/services/cloudinary.service'];
  const saved = paths.map((path) => [require.resolve(path), require.cache[require.resolve(path)]]);
  const calls = [];
  const uploads = [];
  require.cache[saved[0][0]] = { exports: { findById: async (id) => ({ user_id: id, role_id: id, status: 'ACTIVE' }) } };
  require.cache[saved[1][0]] = { exports: { sanitizeUser: (user) => user } };
  require.cache[saved[2][0]] = { exports: {
    create: async (data, actor, images) => { calls.push({ data, actor }); return { ...data, image_urls: await images() }; },
    list: async () => ({ data: [], total: 0 }),
    detail: async (id) => ({ complaint_id: id }),
    reply: async (id, message, actor, images) => ({
      complaint_id: id,
      message,
      sender_id: actor.user_id,
      image_urls: await images(),
    }),
    update: async (id, data) => ({ complaint_id: id, ...data }),
  } };
  require.cache[saved[3][0]] = { exports: {
    uploadMedia: async (file, folder) => {
      uploads.push({ file, folder });
      return { mediaUrl: `https://res.cloudinary.test/${file.originalname}`, publicId: file.originalname, resourceType: 'image' };
    },
    deleteMedia: async () => {},
  } };
  const app = express();
  app.use(express.json());
  app.use('/api/orders', require('../src/routes/order.routes'));
  app.use('/api/complaints', require('../src/routes/complaint.routes'));
  app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const request = (path, role, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path.startsWith('/orders/') ? '/api' + path : '/api/complaints' + path}`, {
    method, headers: { 'content-type': 'application/json', ...(role ? { authorization: `Bearer ${jwt.sign({ sub: String(role) }, require('../src/config/env').jwtSecret)}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const requestImages = (path, role, fields, images) => {
    const body = new FormData();
    Object.entries(fields).forEach(([name, value]) => body.append(name, value));
    images.forEach(({ name, content, type }) => body.append('images', new Blob([content], { type }), name));
    return fetch(`http://127.0.0.1:${server.address().port}/api${path}`, {
      method: 'POST',
      headers: { ...(role ? { authorization: `Bearer ${jwt.sign({ sub: String(role) }, require('../src/config/env').jwtSecret)}` } : {}) },
      body,
    });
  };
  try {
    assert.equal((await request('', null)).status, 401);
    assert.equal((await request('', 3)).status, 403);
    assert.equal((await request('', 1)).status, 200);
    assert.equal((await request('', 2)).status, 200);
    assert.equal((await request('/?queue=INVALID', 2)).status, 400);
    assert.equal((await request('/my/1', 3)).status, 200);
    assert.equal((await request('/my/1', 1)).status, 403);
    assert.equal((await request('/bad', 3)).status, 400);
    assert.equal((await request('/my?page=0', 3)).status, 400);
    assert.equal((await request('/1/assign', 3, 'PATCH', { assignedTo: 1 })).status, 403);
    assert.equal((await request('/1/assign', 2, 'PATCH', { assignedTo: 1 })).status, 403);
    assert.equal((await request('/1/assign', 1, 'PATCH', { assignedTo: 'bad' })).status, 400);
    assert.equal((await request('/1/status', 1, 'PATCH', { status: 'PENDING' })).status, 200);
    assert.equal((await request('/1/status', 1, 'PATCH', { status: 'OPEN' })).status, 400);
    assert.equal((await request('/1/replies', 3, 'POST', { message: '' })).status, 400);
    assert.equal((await request('/1/replies', 2, 'POST', { message: 'Staff response' })).status, 201);
    const replyBody = new FormData();
    replyBody.append('message', 'Additional customer evidence');
    replyBody.append('images', new Blob(['image bytes'], { type: 'image/png' }), 'supplement.png');
    const replyResponse = await fetch(
      `http://127.0.0.1:${server.address().port}/api/complaints/1/replies`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${jwt.sign({ sub: '3' }, require('../src/config/env').jwtSecret)}`,
        },
        body: replyBody,
      },
    );
    assert.equal(replyResponse.status, 201);
    assert.equal(uploads.some((item) => item.file.originalname === 'supplement.png'), true);
    const payload = { complaintType: 'DAMAGED', description: 'Damaged mushrooms', customer_id: 99, status: 'RESOLVED' };
    assert.equal((await request('/orders/1/complaints', 1, 'POST', payload)).status, 403);
    assert.equal((await request('/orders/1/complaints', 3, 'POST', { ...payload, imageUrls: ['https://example.test/image.jpg'] })).status, 400);
    assert.equal((await request('/orders/bad/complaints', 3, 'POST', payload)).status, 400);
    const response = await requestImages('/orders/1/complaints', 3, payload, [
      { name: 'evidence.png', content: 'image bytes', type: 'image/png' },
    ]);
    assert.equal(response.status, 201);
    assert.deepEqual((await response.json()).data.image_urls, ['https://res.cloudinary.test/evidence.png']);
    assert.equal(uploads.length, 2);
    const evidenceUpload = uploads.find((item) => item.file.originalname === 'evidence.png');
    assert.equal(evidenceUpload.folder, 'harvest-complaints');
    assert.equal(calls[0].actor.user_id, 3);
    assert.equal(calls[0].data.orderId, 1);
    assert.equal(calls[0].data.shipmentId, undefined);
    assert.equal((await requestImages('/orders/1/complaints', null, payload, [])).status, 401);
    assert.equal((await request('', 3, 'POST', payload)).status, 404);
    assert.equal(calls[0].data.status, undefined);
    assert.equal(calls[0].data.customer_id, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    saved.forEach(([path, previous]) => { if (previous) require.cache[path] = previous; else delete require.cache[path]; });
  }
});
