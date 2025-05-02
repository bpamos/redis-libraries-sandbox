import redis

# Replace with your Redis Cloud connection details
REDIS_HOST = "redis_endpoint"
REDIS_PORT = 10000
REDIS_PASSWORD = "redis_password"

# Create Redis client
client = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    password=REDIS_PASSWORD,
    ssl=False,  # Redis Cloud does not SSL
    decode_responses=True  # Return strings instead of bytes
)

# Set and get a key
client.set("key_python", "hello from redis_py")
value = client.get("key_python")
print(f"key_python: {value}")