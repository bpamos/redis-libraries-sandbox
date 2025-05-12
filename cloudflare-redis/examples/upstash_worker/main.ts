import { Redis } from '@upstash/redis/cloudflare';

// const redis = new Redis({
//   url: 'https://your-upstash-url.upstash.io', //your Upstash REST URL
//   token: 'your-upstash-token', //your Upstash REST token
// });

const redis = new Redis({
  url: 'https://pure-shrimp-16897.upstash.io',
  token: 'AUIBAAIjcDFjZDkzM2U2OTQ0MWI0OTA5YjM3NDE1ZjdlMDI3NmQ5N3AxMA',
})


export default {
  async fetch(_request: Request): Promise<Response> {
    await redis.set('key_upstash', 'hello from upstash');
    const value = await redis.get('key_upstash');
    return new Response(`Got from Redis: ${value}`);
  },
};
