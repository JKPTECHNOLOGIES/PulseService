# PulseService Backend - Node.js + Express + Prisma
FROM node:20-alpine

# Prisma needs OpenSSL on Alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Install dependencies (includes Prisma CLI used by the entrypoint)
COPY package*.json ./
RUN npm install

# Copy source
COPY . .

# Generate the Prisma client into the image
RUN npx prisma generate

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Strip any CRLF line endings (in case the host is Windows) and make executable
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod +x /usr/local/bin/docker-entrypoint.sh

ENTRYPOINT ["docker-entrypoint.sh"]
