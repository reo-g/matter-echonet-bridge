# Contributing to matter-echonet-bridge

Thank you for your interest in contributing! This guide explains how to set up the development environment and submit changes.

## Development Environment Setup

### Prerequisites

- **Node.js** ≥ 20.19.0 ([download](https://nodejs.org/))
- **npm** ≥ 9
- macOS, Linux, or Windows (WSL2 recommended for UDP multicast)
- No hardware required — `npm test` runs against a built-in EL device emulator.
  For interactive testing, use elemu or MoekadenRoom (see below), or a LAN with
  real ECHONET Lite devices

### Installation

```bash
git clone https://github.com/reo-g/matter-echonet-bridge.git
cd matter-echonet-bridge
npm install
```

### Build

```bash
npm run build   # TypeScript → dist/
```

### Development (hot-reload via tsx)

```bash
npm run dev
```

## Testing

### Automated E2E tests (no hardware required)

```bash
npm test
```

This spins up a scriptable ECHONET Lite device emulator, the bridge (as a child
process), and a matter.js controller — all on localhost — then verifies
commissioning, device discovery, EL→Matter sync, and Matter→EL commands
end-to-end. See [docs/testing.md](docs/testing.md) for the architecture and
troubleshooting (mDNS interface pinning, the dual-port scheme, etc.).

Please run `npm test` before submitting a PR.

### Interactive testing with elemu (official emulator GUI)

[KAIT-HEMS/elemu](https://github.com/KAIT-HEMS/elemu) emulates 30+ device
classes with a web GUI, based on the official Machine Readable Appendix:

```bash
npm run setup:elemu                                  # clone + patch + npm ci

# Terminal 1: elemu (GUI: http://localhost:8880)
cd test/.elemu && ELEMU_BIND_PORT=3611 ELEMU_ALLOW_SELF=1 npm start

# Terminal 2: the bridge in emulator mode
npm run start:emulator
```

### Testing with MoekadenRoom

[MoekadenRoom](https://github.com/SonyCSL/MoekadenRoom) is a simpler ECHONET
Lite emulator (aircon / light / blind / thermometer / lock). Clone and launch
it per its README. If it runs on the same machine as the bridge, start the
bridge with `--allow-self`; if on another machine, plain `npm start` works.

## Matter Commissioning (for end-to-end testing)

After starting the bridge, commission it to a Matter controller:

- **Apple Home**: Scan the QR code printed in the bridge log
- **Amazon Alexa**: Use the Matter pairing code
- **Google Home**: Use the Matter pairing code

See [docs/commissioning.md](docs/commissioning.md) for step-by-step instructions.

## Pull Request Guidelines

1. **Fork** the repository and create a feature branch from `main`
2. **Test** your changes: `npm test` must pass (E2E suite, no hardware needed)
3. **Build** must pass: `npm run build` with zero TypeScript errors
4. **Describe** what device types or EPC properties your change affects
5. Keep PRs focused — one feature or fix per PR

### Commit Message Style

```
<type>: <short summary>

<optional body explaining motivation and approach>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`

Example:
```
feat: support humidity sensor (EPC 0xB4) in AirconManager
```

## Adding a New Device Type

Each device type is implemented as a Manager class in [src/bridge.ts](src/bridge.ts). To add a new type:

1. Define the Matter endpoint type (using `@matter/main` cluster definitions)
2. Implement a `XxxManager` class with:
   - `handlePacket(rinfo, els)` — ECHONET Lite → Matter sync
   - `poll()` — periodic property refresh
   - `setAggregator(agg)` — inject the Matter Aggregator
3. Register the manager in `EchonetClient` dispatch
4. Document the EPC ↔ Matter Attribute mapping in [docs/devices.md](docs/devices.md)

## Reporting Bugs

Please use the [GitHub Issues](https://github.com/reo-g/matter-echonet-bridge/issues) page. Include:

- Node.js version (`node --version`)
- ECHONET Lite device model and firmware version (if known)
- Bridge log output (run with `npm run dev`, omit `--quiet`)
- Matter controller app and version

## Code Style

The project uses TypeScript strict mode. There is no linter config yet — just match the existing style. Key conventions:

- `const` over `let` where possible
- Descriptive variable names in English or Japanese (bilingual comments encouraged)
- Keep the suppress-timer pattern intact for bidirectional sync
- Handle `undefined` returns from EPC parsing explicitly with `?? fallback`

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
