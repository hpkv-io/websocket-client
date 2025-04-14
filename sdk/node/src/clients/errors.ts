export class HPKVError extends Error {
  constructor(
    message: string,
    public code?: number
  ) {
    super(message);
    this.name = 'HPKVError';
  }
}

export class ConnectionError extends HPKVError {
  constructor(message: string) {
    super(message);
    this.name = 'ConnectionError';
  }
}

export class TimeoutError extends HPKVError {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export class AuthenticationError extends HPKVError {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}
