# Tiny Park

A small cooperative browser platformer built as a clean-room project inspired by browser co-op puzzle games.

It is intentionally deployable as a **static Cloudflare Pages site**. There is no Node/Express game server.

## Stack

- HTML + CSS + vanilla JavaScript
- Matter.js for host-side physics
- PeerJS / WebRTC for browser-to-browser multiplayer
- Cloudflare Pages for static hosting

## Multiplayer model

The room host is authoritative:

1. The host creates a short room code.
2. The host opens a PeerJS peer with an ID derived from that code.
3. Joining players connect directly to that peer over WebRTC.
4. Clients send input state to the host.
5. The host simulates physics and broadcasts game snapshots about 20 times per second.

This keeps the Cloudflare deployment static. PeerJS Cloud is currently used for signaling.

## Current MVP

- Create room / join by room code
- Up to 8 players
- Host-authoritative multiplayer physics
- Player collision and stacking
- Pushable crate
- Cooperative key + exit objective
- Responsive canvas UI
- Cloudflare Pages `_headers`

## Run locally

Because browser modules and WebRTC expect an HTTP origin, do not open `index.html` directly from the filesystem.

```bash
npm run serve
```

Then open the local URL shown by `serve`. Open two browser windows/tabs to test host + client.

## Cloudflare Pages

Connect the GitHub repository to Cloudflare Pages and use:

- Framework preset: **None**
- Build command: leave empty (or `exit 0` if the UI requires one)
- Build output directory: `.`
- Production branch: `main`

Every push to `main` can then deploy automatically.

## WebRTC caveat

PeerJS Cloud provides signaling, while game data travels over WebRTC. Some restrictive corporate networks, firewalls, or symmetric NAT setups can prevent a direct peer connection. A later production-hardening step would be adding TURN infrastructure and/or replacing the signaling service with infrastructure you control.

## Reference and licensing note

This repository is not a copy of `aeolus-1/picoParkClone`. That public repository was used only as architectural reference because it did not expose a license file when this project was started. Tiny Park uses original code, UI, level data, and visuals.
