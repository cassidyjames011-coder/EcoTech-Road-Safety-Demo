# EcoTech Road Safety Observatory — public demo

This repository contains only the static public evaluation demonstrator. Open `index.html` through GitHub Pages or a local static server.

The patrol response and scenario evidence are simulated. Patrol units are fictional. Public map geography and source snapshots are distinguished from synthetic observations in the interface. Visitor actions do not dispatch real units or write to the operational system.

The Cloudflare public-data Worker is not deployed by this repository. The demo uses bundled source snapshots where available and labels unavailable connections accordingly. This repository contains no authenticated dashboard, database, credentials, or operational API.

The private development repository retains the full project and its open security findings. Publishing this static demo does not resolve those findings or establish production readiness.
