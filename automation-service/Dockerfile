FROM mcr.microsoft.com/playwright:v1.48.0-jammy

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev && npx playwright install chromium

COPY . .

ENV PORT=8787
EXPOSE 8787
CMD ["node", "server.js"]
