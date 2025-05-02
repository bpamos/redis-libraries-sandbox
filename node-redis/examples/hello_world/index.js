import { createClient } from 'redis';

// Replace with your Redis Cloud connection details
// const REDIS_HOST = 'your-redis-hostname.redis.cache.amazonaws.com';
// const REDIS_PORT = 12345;
// const REDIS_PASSWORD = 'your-redis-password';

// Replace with your Redis Cloud connection details
const REDIS_HOST = 'redis-17322.c98.us-east-1-4.ec2.redns.redis-cloud.com';
const REDIS_PORT = 17322;
const REDIS_PASSWORD = 'x28jAoV4idZOBuVsRKBQAG5qKcYSXB1V';

const client = createClient({
  socket: {
    host: REDIS_HOST,
    port: REDIS_PORT,
    tls: false
  },
  password: REDIS_PASSWORD
});

async function run() {
  try {
    await client.connect();
    await client.set('key_node_redis', 'hello from node-redis');
    const value = await client.get('key_node_redis');
    console.log(`hello: ${value}`);
  } catch (err) {
    console.error('Redis error:', err);
  } finally {
    await client.disconnect();
  }
}

run();
