FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY index.ts ./
EXPOSE 4402
CMD ["npx", "tsx", "index.ts"]
