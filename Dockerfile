# Stage 1: Build the application
FROM node:20-alpine AS build

# Accept the API key as a build argument so it can be baked into the static bundle.
# WARNING: This will be visible in the image history AND baked into the client-side
# JavaScript bundle (accessible in the browser). For production, use a backend
# proxy to keep secrets secure.
ARG GEMINI_API_KEY
ENV VITE_GEMINI_API_KEY=$GEMINI_API_KEY

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install

# Copy application source
COPY . .

# Build the project
RUN npm run build

# Stage 2: Serve the application using Nginx
FROM nginx:alpine

# Copy built assets from the build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
