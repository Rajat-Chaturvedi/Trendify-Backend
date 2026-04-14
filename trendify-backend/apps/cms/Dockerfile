# ---- Build stage ----
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./

RUN npm install

COPY . .

RUN npm run build

# ---- Production stage ----
FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

COPY package.json ./

RUN npm install --omit=dev

COPY --from=builder /app/build ./build
COPY --from=builder /app/config ./config
COPY --from=builder /app/src ./src
COPY --from=builder /app/public ./public

USER appuser

EXPOSE 1337

ENV NODE_ENV=production

CMD ["node", "node_modules/.bin/strapi", "start"]
