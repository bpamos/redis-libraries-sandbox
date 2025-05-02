# Hello World – Jedis

This is a simple "Hello World" example using the Jedis Java client to connect to Redis Cloud (no TLS), set a key, and read it back.

## 🔧 Prerequisites

- Java 8+
- [Maven](https://maven.apache.org/)

## 📦 Setup & Run

1. Open `Main.java` and update the following variables with your Redis Cloud connection info:

```java
String redisHost = "your_redis_hostname";
int redisPort = 12345;
String redisPassword = "your_redis_password";
```

# to run
```bash
# Step into the hello_world example folder
cd jedis/examples/hello_world

# Compile and run the example
mvn compile exec:java -Dexec.mainClass=jedis.examples.hello_world.Main
# output
# Retrieved: hello from jedis
```