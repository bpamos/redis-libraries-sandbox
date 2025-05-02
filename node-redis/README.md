# node-redis

This is a simple example using the `node-redis` client to connect to a Redis database in Redis Cloud, write a key, and read it back.

## Prerequisites

- Node.js v16 or higher
- A Redis Cloud database (get one at https://redis.com/try-free/)
  - Copy the `host`, `port`, and `password` from your Redis Cloud connection details

## Setup

1. Open a terminal and navigate to this folder:

```bash
cd node-redis
# install dependencies
npm install
# Add your Redis Cloud connection details to the index.js file.
node index.js