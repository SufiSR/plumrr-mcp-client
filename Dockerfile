FROM node:20-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-alpine AS production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV MCP_PORT=8001
ENV PLUMRR_API_BASE_URL=http://host.docker.internal:8000

EXPOSE 8001

USER node

CMD ["node", "dist/index.js"]
