# Contributing to HPKV WebSocket Client SDK

Thank you for your interest in contributing to the HPKV WebSocket Client SDK! This document provides guidelines and instructions for contributing.

## Code of Conduct

By participating in this project, you agree to abide by our code of conduct: be respectful, considerate, and constructive in all interactions.

## How to Contribute

### Reporting Bugs

If you find a bug, please create an issue with the following information:

- A clear, descriptive title
- Steps to reproduce the issue
- Expected behavior
- Actual behavior
- Environment details (OS, Node.js version, etc.)
- Any additional context (logs, screenshots, etc.)

### Suggesting Features

We welcome feature suggestions! Please create an issue with:

- A clear, descriptive title
- A detailed description of the proposed feature
- The motivation behind the feature
- Possible implementation approaches (if you have ideas)

### Pull Requests

1. Fork the repository
2. Create a feature branch from the `develop` branch using the naming convention `feature/feature-branch-name`
3. Make your changes
4. Run tests to ensure they pass
5. Update documentation as needed
6. Submit a pull request targeting the `develop` branch

For significant changes, please open an issue first to discuss.

## Development Setup
### NodeJS SDK
#### Prerequisites

- Node.js (v18 or later)
- npm or yarn

#### Installation

```bash
# Clone your fork
git clone https://github.com/hpkv-io/websocket-client.git
cd websocket-client

# Install dependencies
cd sdk/node
npm install

# Build the project
npm run build

# Run tests
npm test
```

## Coding Standards

### NodeJS SDK
This project follows strict TypeScript conventions:

- All code must be typed properly
- Follow the existing code style and formatting
- Write tests for new functionality
- Document public API methods with JSDoc comments

We use ESLint and Prettier to enforce coding standards. Run the following commands before submitting:

```bash
# Check linting
npm run lint

# Fix auto-fixable issues
npm run lint:fix

# Format code
npm run format
```

## Documentation

- Update README.md with any new features
- Update examples if necessary

## Release Process

Project maintainers are responsible for releases. The process generally follows:

1. Update the CHANGELOG.md
2. Bump version in package.json
3. Create a new GitHub release
4. Publish to npm

## Adding New Language SDKs

If you're interested in contributing a new language implementation:

1. Create a new directory under `sdk/` with the language name (e.g., `sdk/python`)
2. Follow the established patterns from the existing SDKs
3. Provide equivalent functionality for all WebSocket operations
4. Include comprehensive tests and documentation
5. Update the root README.md to mention the new SDK

## Getting Help

If you need help or have questions:

- Open an issue for specific code-related questions
- Join our community channels (listed in the main README)

Thank you for contributing to the HPKV WebSocket Client SDK! 