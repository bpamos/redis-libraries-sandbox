# node-redis

This folder contains examples using the [`node-redis`](https://github.com/redis/node-redis) client to interact with a Redis database.

## Project Structure

Each example lives in its own subdirectory under `examples/` and contains:
- A `main.js` script that demonstrates the example
- A `package.json` with only the necessary dependencies
- A `README.md` explaining how to run the example

## Redis Connection

All examples use hardcoded connection values pointing to Redis Cloud (no TLS):

```js
const config = {
  socket: {
    host: 'your-redis-host',
    port: 12345
  },
  username: 'your-redis-username',
  password: 'your-redis-password'
};