# Changelog

All notable changes to the HPKV WebSocket Client SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

##[1.2.13]
### Added
Support for CommonJS and ESM

##[1.2.12] - Released at 2025-05-14
### Changed
Improved stability

## [1.2.11] - Released at 2025-05-11
### Fixed
- Fixed issues with throttling feature

## [1.2.10] - Released at 2025-05-1
### Fixed
- Issue with websocket state for browser

## [1.2.9] - Released at 2025-05-1
### Fixed
- Issue with using websocket in environments where window is undefined

## [1.2.8] - Released at 2025-04-28
### Fixed
- Issue with WebSocket object in node environments

## [1.2.7] - Released at 2025-04-27
### Added
- Dynamic Request Throttling feature

## [1.2.6] - Released at 2025-04-22
### Changed
- Enhanced connection and error management

## [1.2.5] - Released at 2025-04-21
### Changed
- Enhanced webcoket usage to support more environments

## [1.2.4] - Released at 2025-04-20
### Fixed
- Removed dependency on node events

## [1.2.3] - Released at 2025-04-14
### Fixed
- Enhanced compatibility with browser

## [1.2.2] - Released at 2025-04-14
### Fixed
- Websocket compatibility issue for browsers

## [1.2.1] - Released at 2025-04-14
### Fixed
- Webpack compatibility issue

## [1.2.0] - Released at 2025-04-14
### Added
- On and Off functions to subscribe
- Optional connection configuration

### Changed
- Improved resource cleanup with proper await/disconnect/destroy sequence
- Added request queueing to queue pending requests when connection fails and resend after reconnection
- Added cleanup task for stale requests
- getConnectionStatus() improved to return more comprehensive status of the client

### Breaking Changes
- disconnect() function was converted to async
- return type for getConnectionStatus() method changed

## [1.1.0]- Released at 2025-04-11
### Changed
- enhanced the API for subscription to changes


## [1.0.0] - Released at 2025/04/05

### Added
- First stable release
- Improved package structure
- Complete integration test suite for both API and Subscription clients
- JSDoc documentation for all client classes and methods

## [0.2.0] - Released at 2025/04/04

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