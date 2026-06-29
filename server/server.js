// server.js — Flip 7 multiplayer backend
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const game = require('./game');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || '/data/rooms.json';

// ── Persistent Storage ──────────────────────────────────────────────────────

function ensureDataDir() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function loadRooms() {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, 'utf8');
      return JSON.parse(raw);
    }
  } catch (e) {
    console.error('Failed to load rooms:', e.message);
  }
  return {};
}

function saveRooms() {
  ensureDataDir();
  try {
    // Prune rooms older than 6 hours
    const cutoff = Date.now() - 6 * 60 * 60 * 1000;
    for (const code of Object.keys(rooms)) {
      if (rooms[code].updatedAt < cutoff) delete rooms[code];
    }
    fs.writeFileSync(DATA_FILE, JSON.stringify(rooms, null, 2));
  } catch (e) {
    console.error('Failed to save rooms:', e.message);
  }
}

let rooms = loadRooms();

// Auto-save every 10 seconds
setInterval(saveRooms, 10000);

// ── WebSocket client tracking ───────────────────────────────────────────────
// Map: ws -> { playerId, roomCode }
const wsClients = new Map();
// Map: roomCode -> Set<ws>
const roomSockets = new Map();

function broadcast(roomCode, msg) {
  const sockets = roomSockets.get(roomCode);
  if (!sockets) return;
  const payload = JSON.stringify(msg);
  sockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  });
}

function broadcastRoom(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  broadcast(roomCode, { type: 'state', room: sanitizeRoom(room) });
}

// Strip deck contents from client view (don't reveal draw pile)
function sanitizeRoom(room) {
  return {
    ...room,
    deck: room.deck ? room.deck.length : 0, // just the count
  };
}

function sendTo(ws, msg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function sendError(ws, message) {
  sendTo(ws, { type: 'error', message });
}

// ── WebSocket handlers ──────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const { type, roomCode, playerId, playerName, targetPlayerId } = msg;

    switch (type) {

      case 'create': {
        if (!playerName) return sendError(ws, 'Name required');
        let code;
        do { code = Math.random().toString(36).slice(2,7).toUpperCase(); }
        while (rooms[code]);
        const id = playerId || uuidv4();
        rooms[code] = game.createRoom(code, playerName, id);
        if (!roomSockets.has(code)) roomSockets.set(code, new Set());
        roomSockets.get(code).add(ws);
        wsClients.set(ws, { playerId: id, roomCode: code });
        saveRooms();
        sendTo(ws, { type: 'joined', roomCode: code, playerId: id });
        broadcastRoom(code);
        break;
      }

      case 'join': {
        if (!roomCode || !playerName) return sendError(ws, 'Room code and name required');
        const code = roomCode.toUpperCase();
        const room = rooms[code];
        if (!room) return sendError(ws, 'Room not found');
        const id = playerId || uuidv4();
        // Check if reconnecting
        const existing = room.players.find(p => p.id === id);
        if (!existing) {
          const result = game.addPlayer(room, playerName, id);
          if (result.error) return sendError(ws, result.error);
        }
        if (!roomSockets.has(code)) roomSockets.set(code, new Set());
        roomSockets.get(code).add(ws);
        wsClients.set(ws, { playerId: id, roomCode: code });
        saveRooms();
        sendTo(ws, { type: 'joined', roomCode: code, playerId: id });
        broadcastRoom(code);
        broadcast(code, { type: 'chat', message: `${playerName} joined the room.` });
        break;
      }

      case 'start': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.startGame(room, playerId);
        if (result.error) return sendError(ws, result.error);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: room.lastMessage });
        break;
      }

      case 'draw': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.drawCard(room, playerId);
        if (result.error) return sendError(ws, result.error);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: room.lastMessage });
        if (result.event === 'freezePending' && Array.isArray(result.freezeTargets)) {
          sendTo(ws, { type: 'freezeTargetRequired', targets: result.freezeTargets });
        }
        if (result.event === 'flip3TargetPending' && Array.isArray(result.flip3Targets)) {
          sendTo(ws, { type: 'flip3TargetRequired', targets: result.flip3Targets });
        }
        break;
      }

      case 'chooseFreezeTarget': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.chooseFreezeTarget(room, playerId, targetPlayerId);
        if (result.error) return sendError(ws, result.error);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: room.lastMessage });
        break;
      }

      case 'chooseFlip3Target': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.chooseFlip3Target(room, playerId, targetPlayerId);
        if (result.error) return sendError(ws, result.error);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: room.lastMessage });
        break;
      }

      case 'pass': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.passPlayer(room, playerId);
        if (result.error) return sendError(ws, result.error);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: room.lastMessage });
        break;
      }

      case 'nextRound': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.nextRound(room, playerId);
        if (result.error) return sendError(ws, result.error);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: room.lastMessage });
        break;
      }

      case 'endGame': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.endGameByHost(room, playerId);
        if (result.error) return sendError(ws, result.error);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: room.lastMessage });
        break;
      }

      case 'closeLobby': {
        const room = rooms[roomCode];
        if (!room) return sendError(ws, 'Room not found');
        const result = game.closeLobbyByHost(room, playerId);
        if (result.error) return sendError(ws, result.error);

        broadcast(roomCode, { type: 'roomClosed', message: 'Lobby closed by host.' });

        const sockets = roomSockets.get(roomCode);
        if (sockets) {
          sockets.forEach(sock => wsClients.delete(sock));
          roomSockets.delete(roomCode);
        }
        delete rooms[roomCode];
        saveRooms();
        break;
      }

      case 'ping': {
        sendTo(ws, { type: 'pong' });
        break;
      }

      default:
        sendError(ws, `Unknown message type: ${type}`);
    }
  });

  ws.on('close', () => {
    const info = wsClients.get(ws);
    if (info) {
      const { playerId, roomCode } = info;
      const sockets = roomSockets.get(roomCode);
      if (sockets) sockets.delete(ws);
      wsClients.delete(ws);

      const room = rooms[roomCode];
      if (room && room.phase === 'lobby') {
        // Only remove from lobby — in-game, keep them so they can reconnect
        const player = room.players.find(p => p.id === playerId);
        const name = player ? player.name : 'A player';
        game.removePlayer(room, playerId);
        saveRooms();
        broadcastRoom(roomCode);
        broadcast(roomCode, { type: 'chat', message: `${name} left the room.` });
      }
    }
    console.log('Client disconnected');
  });

  ws.on('error', (err) => {
    console.error('WS error:', err.message);
  });
});

// ── HTTP ────────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, '../client')));

app.get('/health', (_, res) => res.json({ ok: true, rooms: Object.keys(rooms).length }));

app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ── Start ───────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Flip 7 server running on port ${PORT}`);
  console.log(`Rooms data: ${DATA_FILE}`);
});

process.on('SIGTERM', () => {
  saveRooms();
  process.exit(0);
});
