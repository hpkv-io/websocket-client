# Changelog

All notable changes to the HPKV WebSocket Client SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - Released at 2024/04/05

### Added
- First stable release
- Improved package structure
- Complete integration test suite for both API and Subscription clients
- JSDoc documentation for all client classes and methods

## [0.2.0] - Released at 2024/04/04

### Added
- Enhance README with SDK overview, usage examples, and documentation links

### Fixed
The SDK must be instantiated using base API url, changes were made to work with both base rest API or Websocket API Urls
- Improved WebSocket URL handling in `HPKVSubscriptionClient` to prevent duplicate `/ws` paths
- Improved WebSocket URL handling in `HPKVApiClient` to prevent duplicate `/ws` paths
- Enhanced `WebsocketTokenManager` to properly convert WebSocket protocols (`ws://`, `wss://`) to HTTPS for REST API calls
- Enhanced `WebsocketTokenManager` to remove trailing `/ws` from base URLs when making REST API calls

## [0.1.0] - Initial Release

### Added
- Basic WebSocket client functionality for HPKV
- Support for all HPKV WebSocket API operations (Get, Set, Delete, Patch, Range, Atomic)
- Subscription capabilities for real-time key monitoring
- Token manager for generating WebSocket authentication tokens
- TypeScript definitions for all client interfaces 