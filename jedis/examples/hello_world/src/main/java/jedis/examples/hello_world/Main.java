package jedis.examples.hello_world;
import redis.clients.jedis.Jedis;

public class Main {
    public static void main(String[] args) {
        // Replace with your Redis Cloud details
        String redisHost = "REDIS_ENDPOINT";   // e.g., "redis-12345.c13.us-east-1-4.ec2.cloud.redislabs.com"
        int redisPort = 10000;                      // e.g., 12345
        String redisPassword = "REDIS_PASSWORD";

        try (Jedis jedis = new Jedis(redisHost, redisPort)) {
            jedis.auth(redisPassword);

            jedis.set("key_jedis", "hello from jedis");
            String value = jedis.get("key_jedis");

            System.out.println("Retrieved: " + value);
        }
    }
}
