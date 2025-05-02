import redis

# Replace with your Redis Cloud connection details
REDIS_HOST = "redis-17322.us-east-1.ec2.redns.redis-cloud.com"
REDIS_PORT = 17322
REDIS_PASSWORD = "password"

# Create Redis client
r = redis.Redis(
    host=REDIS_HOST,
    port=REDIS_PORT,
    password=REDIS_PASSWORD,
    ssl=False,  # Redis Cloud does not SSL
    decode_responses=True  # Return strings instead of bytes
)

# Set and get a key
r.set("hello", "world")
value = r.get("hello")
print(f"hello: {value}")