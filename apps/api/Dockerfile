FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
RUN npm ci --workspace apps/api --include-workspace-root

COPY tsconfig.base.json ./
COPY apps/api apps/api

WORKDIR /app/apps/api
RUN npx prisma generate

EXPOSE 3000
