# GO! Portal — imagen de despliegue en la nube (backend NestJS + frontend React estático)
# Build: docker build -t go-portal .
# Run:   docker run -p 3001:3001 -v go-portal-data:/data -e JWT_SECRET=... -e JWT_REFRESH_SECRET=... go-portal

FROM node:20-slim AS build
WORKDIR /repo

# Installed here too so `prisma generate` correctly detects OpenSSL 3.x and
# downloads the matching query engine — otherwise it silently falls back to
# an openssl-1.1.x engine that won't load in the (also openssl-3.x) runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY apps/backend/package.json apps/backend/package-lock.json apps/backend/
COPY apps/frontend/package.json apps/frontend/package-lock.json apps/frontend/
RUN cd apps/backend && npm install
RUN cd apps/frontend && npm install

# Copy only what each build actually needs — never a whole directory, so a
# stray host artifact (a stale dist/, an OS-native node_modules, a leftover
# tsconfig.tsbuildinfo) can never end up inside the image by accident.
COPY apps/backend/src apps/backend/src
COPY apps/backend/prisma/schema.prisma apps/backend/prisma/seed.ts apps/backend/prisma/
COPY apps/backend/prisma/migrations apps/backend/prisma/migrations
COPY apps/backend/tsconfig.json apps/backend/nest-cli.json apps/backend/

COPY apps/frontend/src apps/frontend/src
COPY apps/frontend/public apps/frontend/public
COPY apps/frontend/index.html apps/frontend/tsconfig.json apps/frontend/vite.config.ts apps/frontend/tailwind.config.js apps/frontend/postcss.config.js apps/frontend/

RUN cd apps/backend && npx prisma generate
RUN cd apps/frontend && npm run build
RUN cd apps/backend && npm run build && ls -la dist/main.js

FROM node:20-slim AS runtime
ENV NODE_ENV=production
ENV DISABLE_TUNNEL=true
ENV PORT=3001
ENV DATABASE_URL="file:/data/kiosco.db"

# node:20-slim ships no OpenSSL at all — Prisma's query engine needs libssl at
# runtime to even load, regardless of which engine variant it downloaded.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

WORKDIR /repo
COPY --from=build /repo/apps/backend/node_modules apps/backend/node_modules
COPY --from=build /repo/apps/backend/dist apps/backend/dist
COPY --from=build /repo/apps/backend/prisma apps/backend/prisma
COPY --from=build /repo/apps/backend/package.json apps/backend/package.json
COPY --from=build /repo/apps/frontend/dist apps/frontend/dist

RUN mkdir -p /data
VOLUME ["/data"]

WORKDIR /repo/apps/backend
EXPOSE 3001
CMD ["node", "dist/main.js"]
