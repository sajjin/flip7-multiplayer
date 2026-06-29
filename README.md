# Flip 7 — Online Multiplayer Card Game

Real-time multiplayer Flip 7 using WebSockets, Node.js, and Docker.  
1–8 players · room codes · works across any network.

---

## Quick Start

### Option A — Docker Compose (recommended)

```bash
docker compose up -d
```

Open **http://localhost:3000** — share your machine's IP with friends on any network.

---

### Option B — Docker

```bash
docker build -t flip7 .
docker run -d -p 3000:3000 -v flip7-data:/data --name flip7 flip7
```

---

### Option C — Node.js directly

```bash
cd server
npm install
node server.js
```

Then open `client/index.html` in a browser, or serve the client folder with any static server.

---

## Playing over the internet

To let players outside your local network join:

1. **Port-forward port 3000** on your router to your machine's local IP.
2. Players visit `http://<your-public-ip>:3000`
3. Or use a tunnel like [ngrok](https://ngrok.com):
   ```bash
   ngrok http 3000
   ```
   Share the ngrok URL — anyone worldwide can join.

---

## How to Play

| Action | Description |
|--------|-------------|
| **Draw Card** | Flip the top card onto your hand |
| **Lock In** | Bank your current score and end your turn |

**Number cards (0–12):** Add to your hand. Drawing a duplicate = **BUST** (0 points this round).

**Special cards:**
- `+2` / `+3` — Bonus points added to your score
- `Freeze` — Next player skips their turn
- `Flip 3` — Must draw 3 more cards immediately
- `2nd Chance` — Survive one duplicate draw

**Flip 7:** Collect 7 unique number cards → instant round win + 15 bonus points!

**First to 200 total points wins the game.**

---

## Architecture

```
Browser ──WS──► Node.js/Express (port 3000)
                 ├── WebSocket server (ws)
                 ├── Game engine (game.js)
                 ├── Room state (in-memory + /data/rooms.json)
                 └── Static file serving (client/)
```

- Room state is stored in memory and persisted to `/data/rooms.json` every 10 seconds
- Rooms expire after 6 hours of inactivity
- Players can reconnect to a room using their saved session (localStorage)
- The Docker volume `flip7-data` keeps state across container restarts

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP/WS port |
| `DATA_FILE` | `/data/rooms.json` | Persistent storage path |
| `NODE_ENV` | `production` | Environment |
