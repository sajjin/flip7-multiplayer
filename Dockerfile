FROM node:20-alpine

WORKDIR /app

# Copy server files
COPY server/package.json ./
RUN npm install --production

COPY server/server.js ./
COPY server/game.js ./

# Copy client static files
COPY client/ ./client/

# Create data directory for persistent room storage
RUN mkdir -p /data

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

EXPOSE 3000

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_FILE=/data/rooms.json

CMD ["node", "server.js"]
