FROM node:22-alpine
WORKDIR /app
COPY rewards/package*.json ./
RUN npm ci --omit=dev
COPY rewards/ ./
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["npm","start"]
