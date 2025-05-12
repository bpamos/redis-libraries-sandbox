import { createRedis } from "redis-on-workers";

export default {
  async fetch(request: Request): Promise<Response> {
    ///const redis = createRedis("redis://default:<password>@<host>:<port>");
    const redis = createRedis("redis://default:x28jAoV4idZOBuVsRKBQAG5qKcYSXB1V@redis-17322.c98.us-east-1-4.ec2.redns.redis-cloud.com:17322");

    await redis.send("SET", "key_cloudflare", "hello from redis cloud");
    const value = await redis.send("GET", "key_cloudflare");

    await redis.close();

    return new Response(`Got value: ${value}`);
  },
};
