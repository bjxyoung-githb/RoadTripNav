# Road Trip Navigator (phone edition)

A self-contained web app for your road trip: destination search, best driving
route, live progress, turn-by-turn directions (with spoken voice guidance),
weather ahead, road/weather alerts, upcoming gas/food/rest stops, nearby
named mountain peaks, a fuel range planner, sunrise/sunset info, and a
rest-break timer. Map view defaults to satellite (with road/place labels)
and automatically switches to a plain street map below 40mph, back to
satellite above 50mph.

This version runs entirely on your **phone**, using the phone's own GPS —
no laptop needed, no pairing between devices. Everything (routing, weather,
points of interest) is fetched live from free public services directly by
your phone's browser; nothing goes through any server of mine.

**Safety note:** glance at it like you would any phone GPS app — mounted in
a holder, not held. Voice guidance is there so you don't need to look at
the screen for turns at all.

## 1. One-time setup (do this before Wednesday)

This app needs to be hosted at a real web address for your phone's browser
to trust it enough to share GPS location (a bare file on your phone won't
reliably get that permission). The good news: hosting a few static files
like this is free and takes about 5 minutes, with no ongoing maintenance.

### Easiest option: Netlify Drop (no account needed)

1. On a computer, go to **app.netlify.com/drop** in a browser.
2. Drag the whole folder of files from this download (index.html, app.js,
   style.css) onto the page.
3. Netlify gives you a URL like `https://random-name-1234.netlify.app` —
   that's your app's permanent address. Open it on your phone and you're
   navigating.
4. (Optional) Click "Claim this site" and create a free Netlify account if
   you'd like to be able to update it later or give it a memorable name —
   not required for it to keep working.

### Alternative: GitHub Pages (if you already use GitHub)

1. Create a new repository on GitHub, upload `index.html`, `app.js`, and
   `style.css` to it.
2. In the repo's Settings → Pages, set the source to your main branch.
3. GitHub gives you a URL like `https://yourname.github.io/reponame/`.

Either way, once it's hosted, **bookmark the URL on your phone** (or use
your browser's "Add to Home Screen" option so it opens like an app).

### Get a free OpenRouteService API key (~2 minutes)

This powers the routing, turn-by-turn directions, and destination search.

1. Go to **openrouteservice.org** and click **Sign up** (free).
2. Confirm your email, then log in to the **Dashboard**.
3. Click **Request a token**, choose the **Standard** (free) plan, give it
   any name (e.g. "roadtrip"), and create it.
4. Copy the token/API key shown — you'll paste it into the app once.

The free tier gives you 2,000 routing requests and 1,000 geocoding
(destination search) requests per day, far more than you'll need.

## 2. Using it each day

1. Open your bookmarked URL on your phone.
2. First time only: tap **Enable Voice Guidance** (this is a one-time tap
   Apple/Android require before any app can speak out loud), and open
   Settings (gear icon) to paste in your OpenRouteService API key. Set your
   vehicle's driving range and rest-break interval there too if you want
   those features.
3. Allow the location permission prompt when it appears.
4. Once "GPS: connected" shows at the top, type your destination, pick it
   from the list, and tap **Calculate Route**.
5. Mount your phone like you would for any GPS app and go.

Each day of the trip, just reopen the bookmark and enter that day's
destination as a new leg — previous legs are saved on your phone and
listed so you can quickly reselect a place you've already routed to.

## 3. What each part does

- **Route & turn-by-turn** — calculated by OpenRouteService; the map shows
  your route, your live position, and the full step list with the current
  step highlighted. Spoken prompts announce each turn about a mile ahead
  and again right before it. If you drift off the calculated route, it
  automatically recalculates (and says so out loud).
- **Miles left / ETA / speed** — computed from your live position against
  the route, refreshed continuously as your phone reports new GPS fixes.
- **Satellite / street map** — satellite by default (with labels layered
  on top), switches to street view below 40mph and back above 50mph, with
  a several-second delay to avoid flickering in stop-and-go traffic. Tap
  the button in the map's top-right corner to lock it to one style, or
  back to Auto.
- **Weather Ahead** — from the National Weather Service (free, no key,
  US only), sampled at your current spot and two points further along your
  remaining route, timed to your estimated arrival there.
- **Road & Weather Alerts** — active NWS alerts (winter storm, high wind,
  flood, etc.) near your current location and the same points ahead. There
  is no free, nationwide live-traffic-incident data source, so this is
  weather-based, not live traffic/accident data.
- **Upcoming Stops** — named gas stations, restaurants, rest areas,
  viewpoints, and attractions within about 15 miles roughly ahead of you
  (from OpenStreetMap).
- **Mountains Nearby** — named peaks with known elevation within about
  40 miles of your current location (from OpenStreetMap), with distance and
  compass direction. This is straight-line distance, **not** a true
  line-of-sight calculation — a peak could be listed even if a closer ridge
  actually blocks your view of it.
- **Fuel Planner** — if you set your vehicle's range in Settings, this
  flags when the nearest known gas station ahead is farther than 80% of
  that range. It does not know your actual fuel level.
- **Daylight** — sunrise/sunset times and hours of daylight left at your
  current location.
- **Drive Timer** — tracks continuous driving time (based on GPS speed) and
  pops up a reminder at the interval you set in Settings.

## 4. Troubleshooting

- **"GPS error: allow location access"** — your phone browser blocked or
  you denied the location prompt. Check the site's permissions in your
  browser settings and allow Location, then reload the page.
- **GPS shows connected but position seems off** — normal GPS accuracy is
  shown next to the status (± feet); it should tighten up after a few
  seconds outdoors/moving. Tunnels, parking garages, and dense tree cover
  can cause temporary drift, same as any GPS app.
- **No sound for voice guidance** — make sure you tapped "Enable Voice
  Guidance" once, and that your phone isn't in silent/mute mode (some
  phones block web page audio when the hardware mute switch is on).
- **Routing/geocoding errors mentioning your API key** — double-check you
  pasted the whole key with no extra spaces in Settings.
- **Starlink/cellular brief dropouts** — the app will show stale/error
  states briefly and recover automatically once the connection returns;
  your route and progress tracking don't require a constant connection
  since your position is compared against the already-downloaded route.
- **Overpass (points of interest / peaks) slow or failing** — this uses a
  shared free public server (overpass-api.de) that occasionally rate-limits
  under heavy global usage; it will retry automatically on the next cycle.

## 5. Known limitations (by design, given free/no-cost data sources)

- No live traffic congestion or accident data (no free nationwide source
  exists) — road conditions are weather-based only.
- "Mountains nearby" is a distance-based list, not verified visibility.
- Fuel planner uses a manually-set range, not real fuel-level telemetry.
- Everything requires an internet connection (Starlink, WiFi, or cellular)
  to fetch new routes, weather, and points of interest; there's no offline
  map mode.
- Keeping both satellite and street tiles loaded at all times (for instant,
  stutter-free switching) uses somewhat more mobile data than a single map
  style would — worth knowing if you're on a limited cellular data plan as
  a backup to Starlink.
