# Hello World with redis-py

This example connects to Redis Cloud and performs a basic SET and GET.

## Prerequisites

- Python 3.7 or higher
- A Redis Cloud database (get a free one at https://redis.com/try-free/)
  - Copy the `host`, `port`, `username`, and `password` from your Redis Cloud connection details
- `redis` Python package

## How to Run

1. Update the Redis connection info in `main.py`.
2. Install dependencies:

```bash
cd redis-py
cd examples/hello_world
# create virtual env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# run the script
python main.py
# you should see
# key_python: hello from redis_py

