# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- 10 new device types (Tier 1 + Tier 2 of the device roadmap):
  - Humidity sensor (EL 0x0012) → Matter Humidity Sensor
  - Human detection sensor (EL 0x0007) → Matter Occupancy Sensor
  - Illuminance sensor (EL 0x00D0) → Matter Light Sensor
  - CO2 sensor (EL 0x001B) → Matter Air Quality Sensor (with CO2 concentration)
  - Crime prevention sensor (EL 0x0002) → Matter Contact Sensor
  - Mono functional lighting (EL 0x0291) → Matter On/Off Light
  - Rain sliding door/shutter (EL 0x0263) → Matter Window Covering
  - Ventilation fan (EL 0x0133) → Matter Fan
  - Air cleaner (EL 0x0135) → Matter Air Purifier
  - Floor heater (EL 0x027B) → Matter Thermostat (heating only, ℃/level setpoint auto-detection)
- Color temperature support for general lighting (EL 0x0290 EPC 0xB1):
  auto-detected at discovery, exposed as Color Temperature Light
- `--allow-self` flag to accept EL packets from the local host
  (for running an emulator on the same machine as the bridge)
- Shared `ReadOnlySensorManager` base class for one-way sensor device types
- `docs/device-roadmap.md`: EL ↔ Matter device mapping study (Tier 1-3 candidates)
- **E2E test environment** (`npm test`): scriptable ECHONET Lite device emulator +
  bridge child process + matter.js controller (ClientNode), verifying commissioning,
  discovery, EL→Matter sync and Matter→EL commands on a single machine
  (see `docs/testing.md`)
- `--el-port` flag: send EL packets to a different port while still listening on
  3610, enabling same-host emulator setups (dual-port scheme)
- `--passcode` / `--discriminator` support via matter.js environment variables
  (`MATTER_PASSCODE` / `MATTER_DISCRIMINATOR`) for fixed commissioning credentials
- `npm run setup:elemu`: one-command setup for the official
  [KAIT-HEMS/elemu](https://github.com/KAIT-HEMS/elemu) emulator (with a one-line
  bind-port patch for same-host operation) and `npm run start:emulator` to launch
  the bridge in emulator mode

### Changed

- Renamed project to `matter-echonet-bridge` (source: `src/bridge.ts`,
  Matter storage: `~/.matter/matter-echonet-bridge/` — re-commissioning required)

### Fixed

- A single device failing Matter endpoint initialization no longer crashes the
  whole bridge (per-packet dispatch errors are now caught and logged)

## [1.0.0] - 2025-05-21

### Added

- ECHONET Lite ↔ Matter bridge supporting 5 device types:
  - Air conditioner (EL 0x0130) → Matter Thermostat (power, mode, temperature)
  - Dimmable light (EL 0x0290) → Matter Dimmable Light
  - Window covering / blind (EL 0x0260) → Matter Window Covering
  - Temperature sensor (EL 0x0011) → Matter Temperature Sensor
  - Door lock (EL 0x026F) → Matter Door Lock
- Bidirectional synchronization with suppress-timer feedback loop prevention
- Heartbeat-based device reachability tracking (120s timeout)
- Multi-device support via Matter Aggregator (bridge) pattern
- Matter 1.3/1.4 compatible implementation using `@matter/main` v0.16
- Automatic ECHONET Lite device discovery via multicast UDP
- Graceful shutdown on SIGINT/SIGTERM
- TypeScript source with strict mode and full source maps
- Bilingual documentation (English / Japanese)
- MoekadenRoom emulator support for development without physical devices
- `--quiet` flag for reduced log output
- `--interface` flag for networks with IGMP snooping

[1.0.0]: https://github.com/reo-g/matter-echonet-bridge/releases/tag/v1.0.0
