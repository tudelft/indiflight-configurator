![Indiflight](src/images/if_logo_dark.svg)

# Indiflight App

This is a fork of the Betaflight App with support for [Indiflight](https://github.com/tudelft/indiflight), a fork of
Betaflight. It is based on Betaflight App 2026.6.2 and adds the Indiflight serial functions, beepers, arming flags,
blackbox fields and flight modes. The Indiflight-specific behaviour is only enabled when an Indiflight flight
controller is connected.

Build the web app with Node.js 24 (see `.nvmrc`):

```bash
npm ci
npm run build    # output in src/dist/
npm run preview  # serve the build locally on http://localhost:8080
```

`src/dist/` is a static site. Serve it over HTTPS, which browsers require for Web Serial and WebUSB.

This build does not collect usage statistics and does not use any Betaflight online services (login, cloud
backups, cloud build, presets, support upload, sponsor tiles). Firmware is flashed from local files. Please report
problems with Indiflight or with this app in this repository, not to the Betaflight project.

## License

GPLv3, see [LICENSE](LICENSE). Based on the [Betaflight App](https://github.com/betaflight/betaflight-configurator).
