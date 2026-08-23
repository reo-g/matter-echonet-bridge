# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-23

Initial public release. A bidirectional ECHONET Lite ↔ Matter bridge built on
[matter.js](https://github.com/project-chip/matter.js), exposing ECHONET Lite
devices as Matter accessories controllable from Apple Home / Google Home / Alexa.

### Device types (15)

- Air conditioner (EL 0x0130) → Matter Thermostat (power, mode, temperature)
- General lighting (EL 0x0290) → Dimmable Light, or Color Temperature Light when
  the device supports light-color EPC 0xB1 (auto-detected at discovery)
- Mono functional lighting (EL 0x0291) → Matter On/Off Light
- Blind / shade (EL 0x0260) → Matter Window Covering
- Rain sliding door / shutter (EL 0x0263) → Matter Window Covering
- Temperature sensor (EL 0x0011) → Matter Temperature Sensor
- Humidity sensor (EL 0x0012) → Matter Humidity Sensor
- Human detection sensor (EL 0x0007) → Matter Occupancy Sensor
- Illuminance sensor (EL 0x00D0) → Matter Light Sensor
- CO2 sensor (EL 0x001B) → Matter Air Quality Sensor (with CO2 concentration)
- Crime prevention sensor (EL 0x0002) → Matter Contact Sensor
- Door lock (EL 0x026F) → Matter Door Lock
- Ventilation fan (EL 0x0133) → Matter Fan
- Air cleaner (EL 0x0135) → Matter Air Purifier
- Floor heater (EL 0x027B) → Matter Thermostat (heating only, ℃/level setpoint auto-detection)

### Core

- Bidirectional synchronization with suppress-timer feedback-loop prevention
- Heartbeat-based device reachability tracking (120s timeout)
- Multi-device support via the Matter Aggregator (bridge) pattern
- Automatic ECHONET Lite device discovery via multicast UDP
- Per-packet dispatch errors are caught and logged, so a single device failing
  Matter endpoint initialization never crashes the whole bridge
- Matter 1.3/1.4 compatible implementation using `@matter/main` v0.16
- Graceful shutdown on SIGINT/SIGTERM
- Single-file TypeScript source (~3,000 lines) in strict mode with source maps
- Bilingual documentation (English / Japanese)

### CLI options

- `--quiet` — suppress Matter framework INFO/DEBUG logs
- `--interface <IP>` — pin the multicast interface (IGMP snooping)
- `--allow-self` — accept EL packets from the local host (same-host emulator)
- `--el-port <port>` — send EL packets to a different port while still listening
  on 3610 (dual-port scheme for same-host emulator setups)
- `--passcode` / `--discriminator` — fixed commissioning credentials (also via
  `MATTER_PASSCODE` / `MATTER_DISCRIMINATOR`)

### Testing

- E2E test environment (`npm test`): scriptable ECHONET Lite device emulator +
  bridge child process + matter.js controller (ClientNode), verifying
  commissioning, discovery, EL→Matter sync and Matter→EL commands on a single
  machine (see `docs/testing.md`)
- `npm run setup:elemu` — one-command setup for the official
  [KAIT-HEMS/elemu](https://github.com/KAIT-HEMS/elemu) emulator; `npm run
  start:emulator` launches the bridge in emulator mode

### Notes

- Verified against emulators (the built-in E2E suite and MoekadenRoom), not
  physical appliances yet
- Vendor ID is the CSA test value `0xFFF1` — not for production use

[1.0.0]: https://github.com/reo-g/matter-echonet-bridge/releases/tag/v1.0.0
