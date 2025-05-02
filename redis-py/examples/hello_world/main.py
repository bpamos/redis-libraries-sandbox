import redis

# Replace with your Redis Cloud connection details
REDIS_HOST = "redis-17322.c98.us-east-1-4.ec2.redns.redis-cloud.com"
REDIS_PORT = 17322
REDIS_PASSWORD = "x28jAoV4idZOBuVsRKBQAG5qKcYSXB1V"

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