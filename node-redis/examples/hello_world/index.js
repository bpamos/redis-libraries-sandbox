import { createClient } from 'redis';

// Replace with your Redis Cloud connection details
const REDIS_HOST = 'redis_endpoint';
const REDIS_PORT = 10000;
const REDIS_PASSWORD = 'redis_password';

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
