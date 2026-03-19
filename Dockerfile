FROM node:24-alpine

WORKDIR /app

RUN apk add --no-cache ffmpeg

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

CMD ["npm", "start"]
