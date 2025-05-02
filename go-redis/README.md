# go-redis

This folder demonstrates how to use the [`go-redis`](https://github.com/redis/go-redis) client to connect to Redis Cloud without TLS.

Each example is self-contained, with its own `main.go`, `go.mod`, and a README that describes how to run it.

## Prerequisites

- Go 1.18+
- Redis Cloud database (host, port, password)


### Installing Go (if not installed)

#### macOS (with Homebrew)

```bash
brew install go
# then verify
go version
# if `go` is still not found, add it to your PATH:
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.zshrc
source ~/.zshrc
```

### Example Structure

```bash
go-redis/
├── README.md
└── examples/
    ├── basic_get_set/
    │   ├── README.md
    │   ├── main.go
    │   └── go.mod
    └── ...
```

### Running an Example
Each example lives in its own folder under examples/.

To run the basic get/set example:

```bash
cd examples/basic_get_set
go mod tidy
go run main.go
```

See each example folder's `README.md` for details and Redis configuration instructions.