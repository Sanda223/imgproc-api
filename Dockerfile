# ---- build stage ----
FROM node:20-bullseye-slim AS build
WORKDIR /app

# Install dependencies for building
COPY package*.json tsconfig.json ./
RUN npm ci

# Copy source code and build
COPY src ./src
COPY public ./public
RUN npm run build


# ---- runtime stage ----
FROM node:20-bullseye-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts from the build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public

# Expose API port
EXPOSE 3000

# Optional security hardening
RUN useradd -m appuser
USER appuser

# Start the server
CMD ["node", "dist/src/server.js"]