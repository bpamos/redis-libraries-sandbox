# Jedis Redis Client

This project demonstrates how to use the Jedis Redis client with Redis Cloud (no TLS).

## Structure

Each example is self-contained in the `examples/` directory.

```bash
jedis/
└── examples/
└── hello_world/
├── README.md
├── Main.java
└── pom.xml
```
## Requirements

- Java 8+
- Maven

## Running Examples

```bash
cd examples/hello_world
mvn compile exec:java -Dexec.mainClass=Main
```