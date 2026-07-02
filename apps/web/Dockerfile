FROM node:24-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
RUN npm ci --workspace apps/web --include-workspace-root

COPY tsconfig.base.json ./
COPY apps/web apps/web

WORKDIR /app/apps/web
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=build /app/apps/web/dist /usr/share/nginx/html

EXPOSE 80
