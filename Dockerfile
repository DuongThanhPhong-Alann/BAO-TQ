FROM mcr.microsoft.com/playwright:v1.57.0-jammy AS deps
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci

FROM mcr.microsoft.com/playwright:v1.57.0-jammy AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=deps /app/node_modules ./node_modules
COPY tsconfig.json ./
COPY src ./src
COPY config ./config
RUN npm run build
RUN npm prune --omit=dev

FROM mcr.microsoft.com/playwright:v1.57.0-jammy AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/config ./config
COPY package.json ./
CMD ["node", "dist/index.js", "schedule"]
