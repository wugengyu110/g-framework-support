# syntax=docker/dockerfile:1

FROM mcr.microsoft.com/playwright:v1.62.0-jammy

ENV DEBIAN_FRONTEND=noninteractive \
    G_PPT_ROOT=/app \
    G_PPT_RENDER_BASE_URL=http://127.0.0.1:18800 \
    PORT=18800 \
    npm_config_update_notifier=false

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-wqy-zenhei fontconfig \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm install --prefix frontend

COPY . .
# 硬烧字幕用寒蝉半圆体（圆润）；文泉驿作缺字回退
RUN mkdir -p /usr/share/fonts/truetype/chillround \
  && cp fonts/ChillRoundM/ChillRoundM.ttf /usr/share/fonts/truetype/chillround/ \
  && fc-cache -f \
  && npm run catalog && npm run build

EXPOSE 18800

CMD ["npm", "run", "api"]
