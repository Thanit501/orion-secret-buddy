FROM node:24-slim
WORKDIR /app
COPY package*.json ./
COPY .npmrc ./
RUN npm ci --omit=dev
COPY --chown=node:node public ./public
COPY --chown=node:node src ./src
RUN mkdir -p /app/data && chown node:node /app/data
USER node
ENV PORT=3012 HOST=0.0.0.0 NODE_ENV=production DATABASE_PATH=/app/data/orion.sqlite
EXPOSE 3012
CMD ["node", "src/server.js"]
