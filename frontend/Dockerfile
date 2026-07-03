# syntax=docker/dockerfile:1

# ---- Base: node + deps (shared by dev and build) ----
FROM node:26-alpine AS base
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

COPY . .
RUN npm run build

# ---- Runtime stage (static server) ----
FROM node:26-alpine AS runtime
WORKDIR /app

RUN npm install -g serve@14

COPY --from=build /app/dist ./dist

EXPOSE 5173
CMD ["serve", "-s", "dist", "-l", "5173"]
