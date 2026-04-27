# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Only copy what's needed to run
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY public ./public

EXPOSE 3000

# Ollama runs as a separate sidecar (see docker-compose.yml).
# Override OLLAMA_URL if your Ollama instance is remote.
ENV OLLAMA_URL=http://ollama:11434

CMD ["node", "dist/server.js"]
