# PC relay (optional — only needed for running the main app on a Windows/Mac/Linux PC)

The main Road Trip Navigator app is built to run on a phone, using the
phone's own GPS. That's still the recommended, primary way to use it.

This folder is a small add-on for the specific case where you want to run
the main app's *screen* on a PC (bigger display) instead of a phone. PCs
almost never have real GPS hardware, so this relay lets a phone (which
does) feed its location to the PC over your local WiFi network — the same
idea as the very first version of this project, just now optional rather
than required.

## How it fits together

- **The PC** runs this relay server (`node server.js`) and also has the
  main app open in its browser (the same GitHub Pages link as always).
- **A phone**, on the same WiFi network as the PC, opens this relay's
  `/phone` page and shares its GPS to it.
- The main app, running on the PC, is told (in its Settings) to read its
  location from this relay instead of trying to use the PC's own
  (probably nonexistent or inaccurate) GPS.

Nothing here leaves your local network — the phone talks directly to the
PC, and the PC's browser talks to itself.

## Setup

1. Make sure Node.js is installed on the PC (open a terminal/command
   prompt and run `node -v`; if that fails, install the LTS version from
   nodejs.org).
2. Make sure the PC and the phone providing GPS are on the **same WiFi
   network**.
3. On the PC: **Windows** — double-click `start.bat`. **Mac/Linux** — run
   `./start.sh` in a terminal from this folder (first time: `chmod +x
   start.sh`).
4. The terminal window prints two addresses, like:
   - `https://192.168.1.23:8443/` — open this **in the same browser
     you'll use for the main app**, on the PC. It'll warn "not secure" —
     click Advanced → Proceed. This is a one-time step per browser.
   - `https://192.168.1.23:8443/phone` — open this on the **phone**. It
     will also warn "not secure" the first time — same thing, click
     through it. Tap **Start Sharing Location** and allow the location
     permission prompt.
5. Now open the main app on the PC (your usual GitHub Pages link), go to
   **Settings**, choose **"Phone via local relay"** as the Location
   source, and paste in the exact `https://192.168.1.23:8443` address from
   step 4 (no trailing `/phone`, no trailing slash needed). Save.
6. The connection status at the top of the main app should switch to "GPS:
   via phone relay" within a few seconds.

## Notes

- This relay server needs to keep running (the terminal window stays open)
  for as long as you want live location on the PC. Closing it (or putting
  the PC to sleep) stops the flow — reopen it and the main app will
  reconnect automatically once it's back.
- The phone's IP address can change if it reconnects to WiFi (rare, but
  possible) — if the main app suddenly shows "can't reach relay," check
  the terminal window for a new address and update it in Settings.
- If your Starlink WiFi (or whatever network you're on) isolates devices
  from each other ("client isolation" / "AP isolation"), the phone and PC
  won't be able to reach each other this way — using the phone's own
  personal hotspot instead, with the PC connected to it, avoids that.
- This is the same self-signed-certificate approach as any local HTTPS
  dev tool: safe for this private, local use, but it's why both browsers
  show a one-time warning.
