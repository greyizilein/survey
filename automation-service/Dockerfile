FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
COPY package.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm install --omit=dev

COPY . .

ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.js"]
