FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY sql ./sql
COPY src ./src
COPY public ./public
RUN mkdir -p datos && chown node:node datos
USER node
EXPOSE 8080
CMD ["node", "--no-warnings", "src/index.js"]
