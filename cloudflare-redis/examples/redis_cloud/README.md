# Redis Cloud with Cloudflare Workers (via TCP Socket API)

This example demonstrates how to connect a Cloudflare Worker directly to Redis Cloud using the new [`connect()` TCP socket API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) and the [`redis-on-workers`](https://github.com/cloudflare/redis-on-workers) client.

---

## ✅ What It Does

- Connects to Redis Cloud via a raw TCP socket (no HTTP proxy required)
- Sets a key `key_cloudflare` with value `"hello from redis cloud"`
- Reads the value back and returns it in the HTTP response

---

## ⚠️ Requirements

- You **must disable TLS** in your Redis Cloud database  
  Redis Cloud only supports direct connections over TCP if TLS is **disabled**.
  
  This allows use of `redis://` instead of `rediss://`, which is currently **not supported** in Cloudflare Workers.

---

## 🛠 Setup Instructions

### 1. update the redis cloud password and host
Update main.ts
Replace <username>, <password>, <host>, and <port> with your actual Redis Cloud connection info:
```bash
/const redis = createRedis("redis://default:<password>@<host>:<port>")
```

### 1. Install Dependencies

```bash
cd cloudflare-redis/examples/redis_cloud
npm install redis-on-workers
npm install -g wrangler
# Deploy to Cloudflare:
# log in if not already logged in.
# wrangler login
wrangler deploy
# Your deployed Worker URL will look like:
# https://xxxx-worker.<your-subdomain>.workers.dev
# Visit it in your browser — you should see:
# Got from Redis: hello from redis-cloud
```