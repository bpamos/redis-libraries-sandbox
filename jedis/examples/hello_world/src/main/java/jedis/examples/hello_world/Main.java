package jedis.examples.hello_world;
import redis.clients.jedis.Jedis;

public class Main {
    public static void main(String[] args) {
        // Replace with your Redis Cloud details
        String redisHost = "redis-17322.c98.us-east-1-4.ec2.redns.redis-cloud.com";   // e.g., "redis-12345.c13.us-east-1-4.ec2.cloud.redislabs.com"
        int redisPort = 17322;                      // e.g., 12345
        String redisPassword = "x28jAoV4idZOBuVsRKBQAG5qKcYSXB1V";

        try (Jedis jedis = new Jedis(redisHost, redisPort)) {
            jedis.auth(redisPassword);

            jedis.set("key_jedis", "hello from jedis");
            String value = jedis.get("key_jedis");

            System.out.println("Retrieved: " + value);
        }
    }
}
