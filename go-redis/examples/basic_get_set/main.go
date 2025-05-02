package main

import (
	"context"
	"fmt"
	"github.com/redis/go-redis/v9"
	"log"
	"time"
)

func main() {
	ctx := context.Background()

	// rdb := redis.NewClient(&redis.Options{
	// 	Addr:     "REDIS_HOST:REDIS_PORT", // e.g., "redis-12345.c1.us-west-1-2.ec2.cloud.redislabs.com:12345"
	// 	Password: "REDIS_PASSWORD",       // Redis Cloud password
	// 	DB:       0,                      // default DB
	// 	TLSConfig: nil,                  // disable TLS
	// })

	rdb := redis.NewClient(&redis.Options{
		Addr:     "redis-17322.c98.us-east-1-4.ec2.redns.redis-cloud.com:17322", // e.g., "redis-12345.c1.us-west-1-2.ec2.cloud.redislabs.com:12345"
		Password: "x28jAoV4idZOBuVsRKBQAG5qKcYSXB1V",       // Redis Cloud password
		DB:       0,                      // default DB
		TLSConfig: nil,                  // disable TLS
	})

	key := "mykey"
	value := "Hello, Redis from Go!"

	// Set key
	err := rdb.Set(ctx, key, value, 10*time.Second).Err()
	if err != nil {
		log.Fatalf("Could not set key: %v", err)
	}

	// Get key
	result, err := rdb.Get(ctx, key).Result()
	if err != nil {
		log.Fatalf("Could not get key: %v", err)
	}

	fmt.Printf("Key: %s, Value: %s\n", key, result)
}
