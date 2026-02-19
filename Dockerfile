FROM node:20-slim

# Install Playwright Firefox system dependencies
RUN npx playwright install-deps firefox
RUN npx playwright install firefox

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./
RUN npm install

# Copy app source
COPY . .

# Default to headless mode on Railway
ENV HEADLESS=true
ENV NODE_ENV=production

CMD ["node", "src/index.js"]