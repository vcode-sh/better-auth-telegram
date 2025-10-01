# Contributing to better-auth-telegram

Thank you for your interest in contributing! 🎉

## Development Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Make your changes in the `src/` directory

4. Build the project:
   ```bash
   npm run build
   ```

5. Test your changes locally by linking the package:
   ```bash
   npm link
   ```

## Project Structure

```
better-auth-telegram/
├── src/
│   ├── index.ts          # Server plugin
│   ├── client.ts         # Client plugin
│   ├── types.ts          # TypeScript types
│   └── verify.ts         # Telegram auth verification
├── examples/             # Usage examples
├── dist/                 # Built files (generated)
└── README.md            # Documentation
```

## Guidelines

- Follow the existing code style
- Add comments for complex logic
- Update README.md if adding new features
- Test your changes thoroughly
- Keep dependencies minimal

## Testing Locally

To test the plugin in a real project:

1. Build the plugin: `npm run build`
2. Link it: `npm link`
3. In your test project: `npm link better-auth-telegram`
4. Import and use as documented in README

## Submitting Changes

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Commit your changes: `git commit -m "Add my feature"`
4. Push to your fork: `git push origin feature/my-feature`
5. Open a Pull Request

## Questions?

Feel free to open an issue for any questions or suggestions!
