# HPKV WebSocket Client SDK

![HPKV logo](assets/images/logo.png)

This repository contains HPKV WebSocket client SDK implementations.

## About HPKV

[HPKV](https://hpkv.io) is a high-performance key-value store designed for applications that require ultra-fast data access with consistent performance. It provides:

- Ultra fast access times
- WebSocket API
- REST API
- AI-Powered queries
- Semantic search
- Pub-Sub capabilities for building real-time reactive applications
- Simple yet powerful interface for storing and retrieving data

## Repository Structure

This repository contains WebSocket client SDKs for different programming languages:

```
websocket-client/
├── sdk/
│   └── node/      # NodeJS SDK
│       ├── src/       # Source code
│       ├── examples/  # Usage examples
|       ├── tests/     # integration tests
│       └── README.md  # NodeJS SDK documentation
```

Currently, only the NodeJS SDK is available, with more language implementations coming soon.

## Available SDKs

### NodeJS

- [NodeJS SDK Documentation](sdk/node/README.md)
- Installation: `npm install @hpkv/websocket-client`

## HPKV WebSocket API

The WebSocket API provides a persistent connection for high-performance operations with HPKV. It's designed for applications that need to minimize latency and reduce overhead from multiple HTTP requests.

### Key Features

- **Persistent Connections**: Maintain a single connection for multiple operations
- **Lower Latency**: Minimize round-trip delays compared to REST API
- **Bidirectional Communication**: Enable real-time data updates
- **Key Monitoring (Pub-Sub)**: Get notified when specific keys change
- **Atomic Operations**: Perform atomic increments/decrements and JSON patching

### Operations Supported

- Insert/Update records
- Get records by key
- JSON Patch/Append to records
- Delete records
- Range queries
- Atomic increments/decrements
- Real-time key monitoring (Pub-Sub)

## Getting Started

### 1. Generate an API Key

To start using HPKV, you'll need an API key:

1. Sign up at [hpkv.io](https://hpkv.io)
2. Go to the API Keys section in your Dashboard
3. Click "Generate API Key"
4. Select your preferred region
5. Add an optional description
6. Save your API key securely - you won't be able to see it again

### 2. Install the SDK for Your Preferred Language

Currently, only NodeJS is supported:

```bash
npm install @hpkv/websocket-client
```

## Documentation

- [HPKV Overview](https://hpkv.io/docs/overview)
- [WebSocket API Documentation](https://hpkv.io/docs/websocket-api)
- [Getting Started Guide](https://hpkv.io/docs/getting-started)
- [Real-time Pub-Sub Blog Post](https://hpkv.io/blog/2025/03/real-time-pub-sub)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
