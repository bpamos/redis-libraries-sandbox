# Upstash Redis with Cloudflare Workers

This example demonstrates how to use [Upstash Redis](https://upstash.com/) from within a Cloudflare Worker using the `@upstash/redis/cloudflare` SDK — which supports edge environments natively.

It sets a Redis key, retrieves it, and returns the value in an HTTP response.

---

## Setup Instructions

### 1. Create a Free Upstash Redis Database

Go to [https://console.upstash.com/](https://console.upstash.com/), sign up, and create a Redis database.

Copy your:
- **REST URL**
- **REST Token**

---

### 2. Create the Worker Project

```bash
cd cloudflare-redis/examples/upstash_worker
npm init -y
npm install @upstash/redis
npm install -g wrangler
# log in if not already logged in.
# wrangler login
wrangler deploy
# Your deployed Worker URL will look like:
# https://upstash-worker.<your-subdomain>.workers.dev
# Visit it in your browser — you should see:
# Got from Redis: hello from upstash
