const jwt = require('jsonwebtoken');
const { Server: SocketIOServer } = require('socket.io');
const env = require('../config/env');
const roomModel = require('../models/socketRoom.model');
const { createRoomAccessService, parseRoomRequest, isExpertRole } = require('../services/socketRoom.service');

function getToken(socket) {
  const authToken = socket.handshake.auth && socket.handshake.auth.token;
  if (typeof authToken === 'string' && authToken.trim()) {
    return authToken.replace(/^Bearer\s+/i, '').trim();
  }

  const authorization = socket.handshake.headers.authorization || '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function createSocketServer(httpServer, {
  corsOrigins = env.corsOrigins,
  jwtSecret = env.jwtSecret,
  findUserById = roomModel.findUserForSocket,
  authorizeRoom = createRoomAccessService().canAccess,
  Server = SocketIOServer,
  logger = console,
} = {}) {
  const io = new Server(httpServer, {
    cors: {
      origin: corsOrigins.includes('*') ? '*' : corsOrigins,
    },
  });
  const onlineUsers = new Map();

  io.use(async (socket, next) => {
    const token = getToken(socket);
    if (!token) return next(new Error('Authentication required'));

    let payload;
    try {
      payload = jwt.verify(token, jwtSecret);
    } catch {
      return next(new Error('Invalid or expired token'));
    }

    if (!payload || typeof payload !== 'object') {
      return next(new Error('Invalid or expired token'));
    }
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return next(new Error('Invalid or expired token'));
    }

    let user;
    try {
      user = await findUserById(userId);
    } catch (error) {
      logger.error('Không thể xác thực kết nối socket:', error);
      return next(new Error('Socket authentication unavailable'));
    }
    if (!user || user.status !== 'ACTIVE') {
      return next(new Error('Invalid or inactive user'));
    }

    socket.data.user = {
      userId,
      roleId: Number(user.role_id),
      roleName: user.role_name,
    };
    const rooms = [`user:${userId}`];
    if (Number(user.role_id) === 1) rooms.push('admin');
    else if (isExpertRole(user.role_name)) rooms.push('expert');
    await socket.join(rooms);
    next();
  });

  io.on('connection', (socket) => {
    const { userId, roleId } = socket.data.user;
    let userSockets = onlineUsers.get(userId);
    if (!userSockets) {
      userSockets = new Set();
      onlineUsers.set(userId, userSockets);
    }
    const wasOffline = userSockets.size === 0;
    userSockets.add(socket.id);
    if (wasOffline) {
      io.to('admin').emit('user:presence.updated', { userId, online: true });
    }
    if (roleId === 1) {
      socket.emit('user:presence.snapshot', { userIds: [...onlineUsers.keys()] });
    }

    function acknowledge(callback, response) {
      if (typeof callback === 'function') callback(response);
      else if (!response.ok) socket.emit('room:subscription:error', response);
    }

    async function joinRoom(payload, callback) {
      const request = parseRoomRequest(payload);
      if (!request) {
        acknowledge(callback, { ok: false, code: 'INVALID_ROOM_REQUEST' });
        return;
      }

      try {
        if (!await authorizeRoom(socket.data.user, request.type, request.id)) {
          acknowledge(callback, { ok: false, code: 'ROOM_ACCESS_DENIED' });
          return;
        }
        await socket.join(`${request.type}:${request.id}`);
        acknowledge(callback, { ok: true, type: request.type, id: request.id });
      } catch (error) {
        logger.error('Không thể xác thực quyền truy cập socket room:', error);
        acknowledge(callback, { ok: false, code: 'ROOM_SUBSCRIPTION_FAILED' });
      }
    }

    function leaveRoom(payload, callback) {
      const request = parseRoomRequest(payload);
      if (!request) {
        acknowledge(callback, { ok: false, code: 'INVALID_ROOM_REQUEST' });
        return;
      }
      socket.leave(`${request.type}:${request.id}`);
      acknowledge(callback, { ok: true, type: request.type, id: request.id });
    }

    socket.on('room:join', joinRoom);
    socket.on('room:leave', leaveRoom);
    socket.on('error', (error) => {
      logger.error('Lỗi kết nối socket:', { userId, error });
    });
    socket.on('disconnect', (reason) => {
      const activeSockets = onlineUsers.get(userId);
      if (activeSockets) {
        activeSockets.delete(socket.id);
        if (activeSockets.size === 0) {
          onlineUsers.delete(userId);
          io.to('admin').emit('user:presence.updated', { userId, online: false });
        }
      }
      logger.info?.('Socket đã ngắt kết nối:', { userId, reason });
    });
  });

  return io;
}

let socketServer;

function initializeSocketServer(httpServer, options) {
  if (socketServer) throw new Error('Socket.IO server has already been initialized');
  socketServer = createSocketServer(httpServer, options);
  return socketServer;
}

function getSocketServer() {
  if (!socketServer) throw new Error('Socket.IO server has not been initialized');
  return socketServer;
}

function emitToUser(userId, event, payload) {
  const parsedUserId = Number(userId);
  if (!Number.isSafeInteger(parsedUserId) || parsedUserId <= 0) {
    throw new TypeError('userId must be a positive integer');
  }
  if (typeof event !== 'string' || !event.trim()) {
    throw new TypeError('event must be a non-empty string');
  }
  getSocketServer().to(`user:${parsedUserId}`).emit(event, payload);
}

function emitToSession(sessionId, event, payload) {
  const parsedSessionId = Number(sessionId);
  if (!Number.isSafeInteger(parsedSessionId) || parsedSessionId <= 0) {
    throw new TypeError('sessionId must be a positive integer');
  }
  if (typeof event !== 'string' || !event.trim()) {
    throw new TypeError('event must be a non-empty string');
  }
  getSocketServer().to(`session:${parsedSessionId}`).emit(event, payload);
}

function emitToRoom(roomId, event, payload) {
  const parsedRoomId = Number(roomId);
  if (!Number.isSafeInteger(parsedRoomId) || parsedRoomId <= 0) {
    throw new TypeError('roomId must be a positive integer');
  }
  if (typeof event !== 'string' || !event.trim()) {
    throw new TypeError('event must be a non-empty string');
  }
  getSocketServer().to(`room:${parsedRoomId}`).emit(event, payload);
}

module.exports = {
  createSocketServer,
  initializeSocketServer,
  getSocketServer,
  emitToUser,
  emitToSession,
  emitToRoom,
};
