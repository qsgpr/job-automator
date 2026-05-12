# ── Build stage ───────────────────────────────────────────────────────────────
FROM node:22-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm install --legacy-peer-deps

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

# Install Playwright system dependencies + Xvfb for headed mode + novnc tools
RUN apt-get update && apt-get install -y \
    libnss3 libnspr4 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
    libpangocairo-1.0-0 libcairo2 libatspi2.0-0 libwayland-client0 \
    xvfb x11vnc websockify novnc \
    --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Copy app
COPY --from=builder /app/dist        ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY public ./public
COPY form.html ./

# Install Playwright browsers (chromium only)
RUN npx playwright install chromium

# Create screenshots dir
RUN mkdir -p /app/public/screenshots

EXPOSE 3000
EXPOSE 6080

# Start Xvfb + VNC + app
COPY start.sh /start.sh
RUN chmod +x /start.sh
CMD ["/start.sh"]
