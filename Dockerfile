FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache wget

# Copy server files
COPY server/package.json ./server/package.json
WORKDIR /app/server
RUN npm install --production
WORKDIR /app

COPY server/ ./server/

# Copy client static files
COPY client/ ./client/

# Create data directory for persistent room storage
RUN mkdir -p /data
RUN touch /data/rooms.json

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:4567/health || exit 1

EXPOSE 4567

ENV NODE_ENV=production
ENV PORT=4567
ENV DATA_FILE=/data/rooms.json

CMD ["node", "server/server.js"]
