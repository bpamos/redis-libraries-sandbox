import { createRedis } from "redis-on-workers";

export default {
  async fetch(request: Request): Promise<Response> {
    const redis = createRedis("redis://default:<password>@<host>:<port>");
    await redis.send("SET", "key_cloudflare", "hello from redis cloud");
    const value = await redis.send("GET", "key_cloudflare");

    await redis.close();

    return new Response(`Got value: ${value}`);
  },
};
