# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

# Copy workspace root and api package manifests
COPY package.json ./
COPY apps/api/package.json ./apps/api/

# Install all dependencies (including devDependencies for build)
RUN npm install --workspace=apps/api

# Copy source
COPY apps/api/ ./apps/api/

# Generate Prisma client
RUN npm run --workspace=apps/api -- npx prisma generate --schema=prisma/schema.prisma || true

# Compile TypeScript
RUN npm run build --workspace=apps/api

# ---- Production stage ----
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy workspace root package.json for workspace resolution
COPY package.json ./
COPY apps/api/package.json ./apps/api/

# Install production dependencies only
RUN npm install --workspace=apps/api --omit=dev

# Copy compiled output and prisma schema
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/prisma ./apps/api/prisma

# Switch to non-root user
USER appuser

EXPOSE 3000

CMD ["node", "apps/api/dist/server.js"]
