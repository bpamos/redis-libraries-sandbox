# redis-py Examples

This folder contains self-contained examples using the [`redis-py`](https://github.com/redis/redis-py) client with Redis Cloud (no TLS).

Each example is isolated in its own folder with a separate virtual environment and dependency file.

## Structure
```bash
redis-py/
├── README.md # (this file)
└── examples/
└── hello_world/ # Basic GET and SET example
├── main.py
├── requirements.txt
└── README.md
```

## Prerequisites

- Python 3.7 or higher
- A Redis Cloud database ([get one for free](https://redis.com/try-free/))
- Internet connection to install dependencies

## How to Run Any Example

Each example has its own `README.md` with instructions, but the general pattern is:

```bash
cd redis-py/examples/<example_name>
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python main.py
```