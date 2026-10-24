const crypto = require('crypto');
const env = require('../config/env');
const AppError = require('../utils/app-error');

const REQUEST_TIMEOUT_MS = 15000;
let cachedToken;

function getApiUrl(method) {
  const region = env.imouRegion;
  if (region && !/^[a-z0-9-]+$/i.test(region)) {
    throw new AppError('Invalid Imou region configuration', 500);
  }
  const host = region
    ? `openapi-${region}.easy4ip.com`
    : 'openapi.easy4ip.com';
  return `https://${host}/openapi/${method}`;
}

function createRequestId() {
  return crypto.randomBytes(16).toString('hex');
}

function createSystem() {
  const time = Math.floor(Date.now() / 1000);
  const nonce = createRequestId();
  const sign = crypto
    .createHash('md5')
    .update(`time:${time},nonce:${nonce},appSecret:${env.imouAppSecret}`)
    .digest('hex');

  return {
    time,
    nonce,
    appId: env.imouAppId,
    sign,
    ver: '1.0',
  };
}

async function callApi(method, params, token) {
  const id = createRequestId();
  const url = getApiUrl(method);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system: createSystem(),
        ...(params ? { params } : {}),
        id,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('Unable to connect to Imou cloud', 502);
  }

  if (!response.ok) {
    throw new AppError('Imou cloud request failed', 502);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new AppError('Imou cloud returned an invalid response', 502);
  }

  if (!body || !body.result || String(body.result.code) !== '0') {
    const code = body && body.result && body.result.code;
    if (token && String(code) === 'TK1002') cachedToken = null;
    const message = body && body.result && body.result.msg;
    const details = [
      code === undefined ? null : `code ${String(code).slice(0, 40)}`,
      typeof message === 'string' && message.trim()
        ? message.replace(/[\r\n]/g, ' ').slice(0, 160)
        : null,
    ].filter(Boolean).join(': ');
    const error = new AppError(
      details ? `Imou cloud rejected the request (${details})` : 'Imou cloud rejected the request',
      502,
    );
    if (code !== undefined) error.imouCode = String(code);
    throw error;
  }

  return body.result.data || {};
}

async function getAccessToken() {
  if (!env.imouAppId || !env.imouAppSecret) {
    throw new AppError('Imou cloud integration is not configured', 503);
  }

  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const data = await callApi('accessToken');
  if (!data.accessToken) {
    throw new AppError('Imou cloud did not return an access token', 502);
  }

  const expiresIn = Number(data.expireTime || data.expiresIn || data.expireIn);
  const cacheSeconds = Number.isFinite(expiresIn) && expiresIn > 0
    ? Math.min(expiresIn, 7200)
    : 3600;
  cachedToken = {
    value: data.accessToken,
    expiresAt: Date.now() + Math.max(cacheSeconds - 60, 60) * 1000,
  };
  return cachedToken.value;
}

async function getLiveStream(deviceId, channelId = '0', streamId = 0) {
  const params = (token) => ({ token, deviceId, channelId });
  async function requestStream(token) {
    let bound = {};
    try {
      bound = await callApi(
        'bindDeviceLive',
        { ...params(token), streamId },
        token,
      );
    } catch (error) {
      if (error.imouCode !== 'LV1001') throw error;
    }
    const liveInfo = await getLiveStreamInfoWithToken(deviceId, channelId, token);
    return { bound, liveInfo };
  }

  let token = await getAccessToken();
  let result;
  try {
    result = await requestStream(token);
  } catch (error) {
    if (error.imouCode !== 'TK1002') throw error;
    cachedToken = null;
    token = await getAccessToken();
    result = await requestStream(token);
  }

  const { bound, liveInfo } = result;
  const streams = liveInfo.streams && liveInfo.streams.length
    ? liveInfo.streams
    : bound.streams || [];
  const availableStreams = [0, 1].map((id) => {
    const matchingStreams = streams.filter((stream) => (
      String(stream.streamId) === String(id)
      && typeof stream.hls === 'string'
      && stream.hls
    ));
    const selectedStream = matchingStreams.find((stream) => stream.hls.startsWith('https://'))
      || matchingStreams[0];
    return selectedStream
      ? { url: selectedStream.hls, protocol: 'hls', streamId: id }
      : null;
  }).filter(Boolean);
  const selected = availableStreams.find(
    (stream) => String(stream.streamId) === String(streamId),
  );
  if (!selected) {
    throw new AppError('Imou cloud did not return an HLS live-stream URL', 502);
  }
  return { ...selected, streams: availableStreams };
}

async function getLiveStreamInfoWithToken(deviceId, channelId, token) {
  return callApi('getLiveStreamInfo', { token, deviceId, channelId }, token);
}

async function getLiveStreamInfo(deviceId, channelId = '0') {
  const token = await getAccessToken();
  try {
    return await getLiveStreamInfoWithToken(deviceId, channelId, token);
  } catch (error) {
    if (error.imouCode !== 'TK1002') throw error;
    cachedToken = null;
    return getLiveStreamInfoWithToken(deviceId, channelId, await getAccessToken());
  }
}

async function stopLiveStream(deviceId, channelId = '0') {
  const liveInfo = await getLiveStreamInfo(deviceId, channelId);
  const liveToken = liveInfo.liveToken;
  if (typeof liveToken !== 'string' || !liveToken) {
    return { stopped: false, channelId, reason: 'NO_ACTIVE_LIVE_SESSION' };
  }

  const token = await getAccessToken();
  try {
    await callApi('unbindLive', { liveToken, token }, token);
  } catch (error) {
    if (error.imouCode !== 'TK1002') throw error;
    cachedToken = null;
    const refreshedToken = await getAccessToken();
    await callApi('unbindLive', { liveToken, token: refreshedToken }, refreshedToken);
  }
  return { stopped: true, channelId };
}

async function listLiveStreams(start = 1, limit = 20) {
  const token = await getAccessToken();
  const end = start + limit - 1;
  let data;
  try {
    data = await callApi(
      'liveList',
      { token, queryRange: `${start}-${end}` },
      token,
    );
  } catch (error) {
    if (error.imouCode !== 'TK1002') throw error;
    cachedToken = null;
    const refreshedToken = await getAccessToken();
    data = await callApi(
      'liveList',
      { token: refreshedToken, queryRange: `${start}-${end}` },
      refreshedToken,
    );
  }
  return {
    count: Number(data.count) || 0,
    lives: Array.isArray(data.lives) ? data.lives : [],
  };
}

async function stopLiveSession(liveToken) {
  const token = await getAccessToken();
  try {
    await callApi('unbindLive', { liveToken, token }, token);
  } catch (error) {
    if (error.imouCode !== 'TK1002') throw error;
    cachedToken = null;
    const refreshedToken = await getAccessToken();
    await callApi(
      'unbindLive',
      { liveToken, token: refreshedToken },
      refreshedToken,
    );
  }
  return { stopped: true };
}

module.exports = {
  getLiveStream,
  getLiveStreamInfo,
  listLiveStreams,
  stopLiveStream,
  stopLiveSession,
};
