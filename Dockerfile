# One image with the API and the web app. Runs migrations, then serves on $PORT.
#   docker build -t academy-lms .
#   docker run -p 3000:3000 -e DATABASE_URL=... -e JWT_SECRET=... academy-lms

FROM node:24-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY apps/api/package.json apps/api/package-lock.json apps/api/
COPY apps/web/package.json apps/web/package-lock.json apps/web/
RUN npm ci --prefix apps/api && npm ci --prefix apps/web
COPY apps ./apps
RUN npm --prefix apps/web run build && npm --prefix apps/api run build \
 && npm prune --omit=dev --prefix apps/api

FROM node:24-slim
ENV NODE_ENV=production PORT=3000 WEB_DIST=/app/web
WORKDIR /app/api
COPY --from=build /app/apps/api/package.json ./
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/drizzle ./drizzle
COPY --from=build /app/apps/web/dist/web/browser /app/web
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD node -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/main.js"]
