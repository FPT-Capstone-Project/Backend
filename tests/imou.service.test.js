const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function configureImou(fetchImplementation) {
  const env = require('../src/config/env');
  const original = {
    fetch: global.fetch,
    appId: env.imouAppId,
    appSecret: env.imouAppSecret,
    region: env.imouRegion,
  };
  env.imouAppId = 'test-app';
  env.imouAppSecret = 'test-secret';
  env.imouRegion = '';
  global.fetch = fetchImplementation;
  return () => {
    global.fetch = original.fetch;
    env.imouAppId = original.appId;
    env.imouAppSecret = original.appSecret;
    env.imouRegion = original.region;
  };
}

test('gets the Imou HLS URL using signed Open Platform requests', async () => {
  const requests = [];
  const responses = [
    { accessToken: 'temporary-token', expireTime: 3600 },
    { streams: [] },
    {
      streams: [
        { streamId: 0, hls: 'https://video.example/audio-only.m3u8' },
        { streamId: 1, hls: 'https://video.example/video.m3u8' },
        { streamId: 1, hls: 'http://video.example/video.m3u8' },
        { streamId: 0, hls: 'http://video.example/audio-only.m3u8' },
      ],
    },
  ];
  const restore = configureImou(async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ url, request });
    return {
      ok: true,
      json: async () => ({ result: { code: '0', data: responses.shift() } }),
    };
  });

  try {
    delete require.cache[require.resolve('../src/services/imou.service')];
    const service = require('../src/services/imou.service');
    const stream = await service.getLiveStream('device-123', '0', 0);
    assert.deepEqual(stream, {
      url: 'https://video.example/audio-only.m3u8',
      protocol: 'hls',
      streamId: 0,
      streams: [
        {
          url: 'https://video.example/audio-only.m3u8',
          protocol: 'hls',
          streamId: 0,
        },
        {
          url: 'https://video.example/video.m3u8',
          protocol: 'hls',
          streamId: 1,
        },
      ],
    });
    assert.deepEqual(requests.map(({ url }) => url.split('/').pop()), [
      'accessToken',
      'bindDeviceLive',
      'getLiveStreamInfo',
    ]);
    assert.deepEqual(requests[1].request.params, {
      token: 'temporary-token',
      deviceId: 'device-123',
      channelId: '0',
      streamId: 0,
    });
    assert.equal(requests[2].request.params.token, 'temporary-token');
    assert.equal(requests[1].request.system.token, undefined);

    for (const { request } of requests) {
      const { time, nonce, sign } = request.system;
      const expectedSign = crypto.createHash('md5')
        .update(`time:${time},nonce:${nonce},appSecret:test-secret`)
        .digest('hex');
      assert.equal(request.system.appId, 'test-app');
      assert.equal(sign, expectedSign);
    }
  } finally {
    restore();
  }
});

test('does not fall back to another stream when the requested stream is unavailable', async () => {
  const responses = [
    { accessToken: 'temporary-token', expireTime: 3600 },
    { streams: [] },
    { streams: [{ streamId: 1, hls: 'https://video.example/video.m3u8' }] },
  ];
  const restore = configureImou(async () => ({
    ok: true,
    json: async () => ({ result: { code: '0', data: responses.shift() } }),
  }));

  try {
    delete require.cache[require.resolve('../src/services/imou.service')];
    const service = require('../src/services/imou.service');
    await assert.rejects(
      service.getLiveStream('device-123', '0', 0),
      /Imou cloud did not return an HLS live-stream URL/,
    );
  } finally {
    restore();
  }
});

test('refreshes the access token once when Imou returns TK1002', async () => {
  const requests = [];
  let bindAttempts = 0;
  const restore = configureImou(async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ url, request });
    if (url.endsWith('/accessToken')) {
      const tokenNumber = requests.filter(({ url: requestUrl }) => (
        requestUrl.endsWith('/accessToken')
      )).length;
      return {
        ok: true,
        json: async () => ({
          result: {
            code: '0',
            data: {
              accessToken: tokenNumber === 1 ? 'temporary-token' : `token-${tokenNumber}`,
              expireTime: 3600,
            },
          },
        }),
      };
    }
    if (url.endsWith('/bindDeviceLive')) {
      bindAttempts += 1;
      if (bindAttempts === 1) {
        return {
          ok: true,
          json: async () => ({
            result: { code: 'TK1002', msg: 'Token expired or does not exist' },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          result: {
            code: '0',
            data: { streams: [{ streamId: 0, hls: 'https://video.example/live.m3u8' }] },
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ result: { code: '0', data: { streams: [] } } }),
    };
  });

  try {
    delete require.cache[require.resolve('../src/services/imou.service')];
    const service = require('../src/services/imou.service');
    const result = await service.getLiveStream('device-123');
    assert.equal(result.url, 'https://video.example/live.m3u8');
    assert.equal(requests.filter(({ url }) => url.endsWith('/accessToken')).length, 2);
    const bindRequests = requests.filter(({ url }) => url.endsWith('/bindDeviceLive'));
    assert.equal(bindRequests.length, 2);
    assert.equal(bindRequests[0].request.params.token, 'temporary-token');
    assert.equal(bindRequests[1].request.params.token, 'token-2');
    assert.equal(bindRequests[1].request.system.token, undefined);
  } finally {
    restore();
  }
});

test('reuses an existing Imou live session when bindDeviceLive returns LV1001', async () => {
  const requests = [];
  const restore = configureImou(async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ url, request });
    if (url.endsWith('/accessToken')) {
      return {
        ok: true,
        json: async () => ({
          result: { code: '0', data: { accessToken: 'active-token', expireTime: 3600 } },
        }),
      };
    }
    if (url.endsWith('/bindDeviceLive')) {
      return {
        ok: true,
        json: async () => ({
          result: { code: 'LV1001', msg: 'The video live exists.' },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({
        result: {
          code: '0',
          data: { streams: [{ streamId: 0, hls: 'https://video.example/existing.m3u8' }] },
        },
      }),
    };
  });

  try {
    delete require.cache[require.resolve('../src/services/imou.service')];
    const service = require('../src/services/imou.service');
    const result = await service.getLiveStream('device-123');
    assert.equal(result.url, 'https://video.example/existing.m3u8');
    assert.deepEqual(requests.map(({ url }) => url.split('/').pop()), [
      'accessToken',
      'bindDeviceLive',
      'getLiveStreamInfo',
    ]);
  } finally {
    restore();
  }
});

test('lists Imou live sessions with pagination and unbinds a selected live token', async () => {
  const requests = [];
  const restore = configureImou(async (url, options) => {
    const request = JSON.parse(options.body);
    requests.push({ url, request });
    if (url.endsWith('/accessToken')) {
      return {
        ok: true,
        json: async () => ({
          result: { code: '0', data: { accessToken: 'admin-token', expireTime: 3600 } },
        }),
      };
    }
    if (url.endsWith('/liveList')) {
      return {
        ok: true,
        json: async () => ({
          result: {
            code: '0',
            data: {
              count: 1,
              lives: [{ liveToken: 'live-123', deviceId: 'device-123', liveStatus: 1 }],
            },
          },
        }),
      };
    }
    return {
      ok: true,
      json: async () => ({ result: { code: '0', data: {} } }),
    };
  });

  try {
    delete require.cache[require.resolve('../src/services/imou.service')];
    const service = require('../src/services/imou.service');
    const list = await service.listLiveStreams(21, 10);
    assert.equal(list.count, 1);
    assert.equal(list.lives[0].liveToken, 'live-123');
    const listRequest = requests.find(({ url }) => url.endsWith('/liveList'));
    assert.deepEqual(listRequest.request.params, {
      token: 'admin-token',
      queryRange: '21-30',
    });

    await service.stopLiveSession('live-123');
    const stopRequest = requests.find(({ url }) => url.endsWith('/unbindLive'));
    assert.deepEqual(stopRequest.request.params, {
      liveToken: 'live-123',
      token: 'admin-token',
    });
  } finally {
    restore();
  }
});
