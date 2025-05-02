# socket.io Redis Adapter Example (Redis Cloud, No TLS)

This demo shows how to use the `@socket.io/redis-adapter` with Redis Cloud to sync events between multiple Socket.IO servers using Redis pub/sub.

## What It Does

- Runs two Socket.IO servers (`server1.js` on port 3000, `server2.js` on port 3001)
- Each server emits a test message every 5 seconds
- Messages are synced via Redis so both servers can broadcast to clients
- A browser client (served by `server1.js`) receives and logs all messages

## Prerequisites

- Node.js v16 or higher
- A Redis Cloud database with Pub/Sub enabled (get one at https://redis.com/try-free/)
  - Copy your Redis **host**, **port**, and **password**

## Setup

1. Clone this repo and open a terminal in the folder

2. Install dependencies:

```bash
# only run in 1 termial
npm install
# Update Redis connection details in both server1.js and server2.js:
const pubClient = createClient({
  host: 'your-redis-host',
  port: 12345,
  password: 'your-password',
  tls: false
});
### NOTE*
# this also works with active-active, where you can put db 1 endpoint in server 1 and db 2 endpoint in server 2

# Start both servers in separate terminals:
PORT=3000 node server1.js
PORT=3001 node server2.js
# Open client.html in your browser:
# http://localhost:3000/client.html
# and
# http://localhost:3001/client.html
# you should see messages like:
## [Server 3000] broadcast test
## [Server 3001] broadcast test
### you can message in both and see it show up in the other clients logs


## How to Verify Redis Sync

Once both servers are running and `client.html` is open in two tabs (one connected to port 3000 and one to 3001):

- Type a message into the input on the page served from **Server 1 (port 3000)**
- Press **Send**
- You should see that message appear:
  - In both browser tabs
  - In the logs of **Server 1**
  - In the logs of **Server 2**

This confirms that Redis is broadcasting messages between both Socket.IO servers as expected.