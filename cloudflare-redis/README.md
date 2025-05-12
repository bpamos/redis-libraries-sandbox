# Redis Examples with Cloudflare Workers

This project demonstrates how to connect Cloudflare Workers to Redis databases using two different approaches:

1. **Upstash Redis** – via HTTPS using the official Upstash SDK  
2. **Redis Cloud** – via TCP socket using Cloudflare's experimental `connect()` API and the `redis-on-workers` library

Both examples live in the `examples/` folder and are deployable to Cloudflare Workers.


## Getting Started with Cloudflare Workers

1. Go to [https://dash.cloudflare.com](https://dash.cloudflare.com) and create a free account
2. Install the Wrangler CLI:

```bash
npm install -g wrangler
## log in
wrangler login
```
* Enable your free workers.dev subdomain:
* Go to Workers & Pages → Your Worker → Settings
* Under Domains & Routes, click Enable next to the workers.dev entry

### more info below:
Enable Your Free `workers.dev` Subdomain

To make your Worker accessible publicly:

1. Go to [https://dash.cloudflare.com](https://dash.cloudflare.com)
2. In the sidebar, go to: **Compute (Workers)** → **Workers & Pages**
3. Click your Worker (e.g. `upstash-worker`)
4. Go to the **Settings** tab
5. Under **Domains & Routes**, click **“Enable”** next to the `workers.dev` entry

This will activate your free public URL:
https://upstash-worker.<your-subdomain>.workers.dev

---

### Examples
* examples/upstash_worker/
Uses the @upstash/redis/cloudflare SDK

Communicates with Redis over HTTPS (REST API)

Works seamlessly in Cloudflare Workers without any TCP or proxy setup

Ideal for edge-native apps

* examples/redis_cloud/
Connects to Redis Cloud using raw TCP via Cloudflare’s connect() API

Uses the redis-on-workers library to issue raw Redis commands

Requires that TLS be disabled in Redis Cloud (only works with redis://)

No proxy needed, but Redis Cloud must accept non-TLS connections