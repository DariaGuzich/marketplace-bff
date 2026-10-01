FROM node:22-slim
WORKDIR /app
# Сначала только package*.json: слой с node_modules кэшируется, пока не меняются зависимости
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json schema.graphql ./
COPY src src
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
