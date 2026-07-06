# syntax=docker/dockerfile:1

# ---- Base: node + deps (shared by dev and build) ----
FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
RUN npm ci

# ---- Dev: vite dev server with HMR (used by docker-compose) ----
FROM base AS dev

COPY . .

EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]

# ---- Build stage ----
FROM base AS build

# Vite bakes this in at build time. Empty (the release default) means relative
# /api/... requests, served same-origin by the nginx proxy in the runtime stage.
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

COPY . .
RUN npm run build

# ---- Runtime stage (nginx: static files + /api proxy to the backend) ----
FROM nginx:alpine AS runtime

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
