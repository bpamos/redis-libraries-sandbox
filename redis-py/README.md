# redis-py

This example demonstrates how to connect to a Redis database using `redis-py`, write a key, and read it back.

## Prerequisites

- Python 3.7 or higher
- A Redis Cloud database (get a free one at https://redis.com/try-free/)
  - Copy the `host`, `port`, `username`, and `password` from your Redis Cloud connection details
- `redis` Python package

## Installation

```bash
cd redis-py
# create virtual env
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
# run the example
python main.py


