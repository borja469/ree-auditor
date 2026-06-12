FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/web --include-workspace-root

COPY tsconfig.base.json ./
COPY apps/web apps/web

WORKDIR /app/apps/web

EXPOSE 5173
