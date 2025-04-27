/**
 * WebSocket Components
 *
 * This module organizes all WebSocket-related functionality
 */

// Core client
export { BaseWebSocketClient } from './base-websocket-client';

// Throttling
export { ThrottlingManager } from './throttling-manager';

// Message handling
export { MessageHandler, DEFAULT_TIMEOUTS } from './message-handler';

// WebSocket adapter and interfaces
export { createWebSocket, BrowserWebSocketAdapter } from './websocket-adapter';
export * from './errors';
export * from './types';
