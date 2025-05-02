# Basic Get/Set Example (go-redis)

This example demonstrates a simple Redis connection using the `go-redis` client library.  
It connects to Redis Cloud (no TLS), sets a key, retrieves it, and prints the value.

## Prerequisites

- Go 1.18 or higher
- A Redis Cloud database (host, port, and password)

## Setup

1. **Install Go** (if not already installed):

```bash
brew install go
go version
# Navigate to this example folder:
cd examples/basic_get_set
# initialize and download dependencies:
go mod tidy
# run example
go run main.go

