FROM node:20-slim

# ffmpeg + python (for yt-dlp) + curl
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip curl \
    && rm -rf /var/lib/apt/lists/*

# install yt-dlp binary (latest)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod +x /usr/local/bin/yt-dlp \
    && yt-dlp --version

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# Render sets PORT=10000, local uses 3000 — both work
EXPOSE 3000
EXPOSE 10000

CMD ["node", "server/index.js"]
