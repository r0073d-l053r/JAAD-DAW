# Stage 1: Build the application
FROM node:20-alpine AS build

# Accept the API key as a build argument so it can be baked into the static
# bundle. ONLY pass this for private/self-hosted builds — a key baked into the
# public bundle is extractable. Public builds are BYOK (see .env.example).
ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=$GEMINI_API_KEY

WORKDIR /app

# Install dependencies reproducibly from the lockfile (fails if out of sync).
COPY package*.json ./
RUN npm ci

# Copy application source
COPY . .

# Build the project
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:alpine

# Security/serving config (COOP/COEP/CSP + SPA + /JAAD-DAW/ base handling).
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy built assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Basic liveness check for orchestrators / compose.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q --spider http://localhost:80/ || exit 1

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
