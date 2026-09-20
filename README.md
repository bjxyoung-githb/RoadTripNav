# Road Trip Navigator (phone edition)

A self-contained web app for your road trip: destination search, best driving
route, live progress, turn-by-turn directions (with spoken voice guidance),
weather ahead, road/weather alerts, upcoming gas/food/rest stops, nearby
named mountain peaks, a fuel range planner, sunrise/sunset info, a
rest-break timer, and (optional) live trip sharing — a passcode family can
enter to watch your position, photos, videos, and comments update in real
time. Map view defaults to satellite (with road/place labels) and
automatically switches to a plain street map below 40mph, back to
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
   style.css, manifest.json, and the assets folder) onto the page.
3. Netlify gives you a URL like `https://random-name-1234.netlify.app` —
   that's your app's permanent address. Open it on your phone and you're
   navigating.
4. (Optional) Click "Claim this site" and create a free Netlify account if
   you'd like to be able to update it later or give it a memorable name —
   not required for it to keep working.

### Alternative: GitHub Pages (if you already use GitHub)

1. Create a new repository on GitHub, upload `index.html`, `app.js`,
   `style.css`, `manifest.json`, and the whole `assets` folder (the app's
   icon) to it, keeping the same folder structure.
2. In the repo's Settings → Pages, set the source to your main branch.
3. GitHub gives you a URL like `https://yourname.github.io/reponame/`.

Either way, once it's hosted, **bookmark the URL on your phone** (or use
your browser's "Add to Home Screen" option so it opens like an app — it'll
use the app's compass icon rather than a generic browser icon).

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
4. Once "GPS: connected" shows at the top, type your destination. Each
   match in the list shows a tag: green "Exact" means it found that precise
   address or place; yellow/red tags ("Street only," "City area," "Region
   only") mean it could only match at that coarser level — common for
   addresses its free map data doesn't have on file. Pick the closest
   match anyway; a small satellite map will appear with a pin you can
   **drag (or tap the map) to nudge onto the exact spot** before
   continuing. This same fine-tune step also appears if you set a manual
   starting point.
5. Tap **Calculate Route**.
6. Mount your phone like you would for any GPS app and go.

Once you arrive, tap **🏁 End This Leg / Plan Next Leg** (below the
Miles/ETA/MPH row) to go back to the planning screen and enter the next
stretch — previous legs are saved on your phone and listed so you can
quickly reselect a place you've already routed to. Reloading the page in
your browser has almost the same effect (it also drops you back at
planning), but skip that if you have live sharing turned on for the leg
you're ending — reloading abandons the share instead of cleanly marking it
"ended," so anyone watching sees a "position may be stale" notice instead
of a clean stop. Tapping **End This Leg** (or **Stop Sharing** on its own)
avoids that.

## 3. What each part does

- **Built-in help** — tap the **❓** in the top bar any time for an overview
  of whatever screen you're currently on (planning, driving, or watching).
  For more detail on one specific feature, look for a small **?** next to
  its name — on a field label, an accordion section like "Weather Ahead,"
  or (for the map itself) a **❓ Help** button in its bottom-left corner.
  Viewers watching a shared trip get their own set of these too, tailored
  to what they can actually do (their map's help explains why their
  tap-for-ETA is an estimate rather than a live calculation, for instance).
  None of this needs an internet lookup — it's all built into the app.
- **Route & turn-by-turn** — calculated by OpenRouteService; the map shows
  your route, your live position, and the full step list with the current
  step highlighted. Spoken prompts announce each turn about a mile ahead
  and again right before it at ordinary speeds; above about 60mph both
  announcements move further out so they still give you a full 60/15
  seconds of warning instead of the same fixed distance shrinking to fewer
  and fewer seconds the faster you're going (see the turn-by-turn
  troubleshooting entry below). The route can only end on a road the map data
  marks as drivable — if your exact pin sits on a private complex/HOA road
  or similar that isn't mapped that way, the route will stop at the nearest
  public road instead. When that gap is more than about 500 feet, a 🏠 pin
  marks your actual destination separately from the blue route-end marker,
  with a warning banner, so you know you'll need to finish the last stretch
  on foot or by eye rather than being silently routed somewhere else.
- **Trip progress bar** — a simple visual right under the turn banner
  showing what percent of the leg's total distance you've driven so far,
  alongside the actual mileage ("38% · 62 mi of 165 mi"). Family watching
  your shared trip see the identical bar on their screen too, worked out
  from the same route and position data they already get — nothing extra
  to set up.
- **Off-route reroute offer** — if you drift noticeably off the calculated
  route, by default the app asks rather than assuming: a banner pops up
  ("Looks like you're taking a different way. Recalculate the route from
  here?") with **🔄 Reroute** and **Keep Going This Way** buttons, and it
  says the offer out loud once too. Tap **Keep Going This Way** and it stays
  quiet for that detour — no repeated nagging every couple minutes — but a
  small 🔄 button stays near the map the whole time you're off-route in
  case you change your mind partway through. Getting back near the original
  route resets it, so a later detour gets asked about fresh. If you'd
  rather it just recalculate automatically with no prompt (the only
  behavior before this existed), Settings → "When you go off the planned
  route" has that as the other option.
- **Route preference (back roads vs. interstate)** — in Settings, choose
  **Fastest route** (the old default — highways/interstates used as
  needed), **Prefer back roads if it's not much slower** (calculates both
  the fastest route and an all-back-roads route, and uses the back-roads
  one as long as it's within however many extra minutes you set — a toast
  tells you which way it went and by how much), or **Always take back
  roads, no matter the time** (avoids limited-access highways/interstates
  entirely). This applies to Calculate Route, automatic off-route
  rerouting, and tap-anywhere-for-ETA, so however you've set it, everything
  routes that way. It can't detect a specific slow left-lane camper — there's
  no free live-traffic-lane data source for that — but staying off the
  interstate generally means an oncoming lane is available to legally pass
  when the way ahead is clear, which sidesteps that annoyance structurally.
  If no back-roads-only path exists for some stretch (rare), it quietly
  falls back to the regular route rather than failing.
- **Stopping for the night mid-leg** — you don't need to do anything
  special to stop driving partway through a leg (say, an overnight hotel
  stop before reaching that day's actual destination). If your phone's
  browser tab stays open, everything just picks back up on its own once
  you're moving again the next morning — same route, same share link if
  you were sharing. If the app gets fully closed overnight (very possible
  after being locked for 8+ hours — phones reclaim memory from backgrounded
  tabs), reopening it shows a **"You have an unfinished trip…"** banner
  with a **▶ Resume Trip** button that restores your route and reconnects
  your existing share link — family never needs a new one. If you were
  sharing, tapping **⏸ Pause for the Night** in the Share & Trip Log panel
  (see below) also shows family a friendly "taking a break" message
  instead of the app's generic staleness note while you're stopped; it
  clears itself automatically once you've driven a bit the next morning
  (or tap **▶ Resume Sharing** yourself).
- **Miles left / ETA / speed / elevation** — computed from your live
  position against the route, refreshed continuously as your phone reports
  new GPS fixes. Elevation comes from OpenRouteService's own route data
  (requested alongside the route itself, no extra lookups) rather than a
  phone's GPS altitude reading, which tends to be unreliable or missing
  entirely on most phones. On a leg long enough that arrival won't be
  today, a small date (Tomorrow, or the weekday and date further out)
  appears right under the ETA time so it can't be misread as "later
  today."
- **Tap the map for an ETA anywhere** — tap any spot on the map (a town
  ahead, a point along your route, or somewhere off it entirely — a detour,
  a nearby landmark, anything) and a pin drops showing the place name,
  drive distance, drive time, a clock-time ETA, the elevation there, and
  the current weather. This is a fresh, separate calculation each time and
  never changes your actual planned route — it's just "how long would it
  take to get *there* from where I am right now." Anyone watching your
  shared trip can tap their map too, but their version is an estimate
  rather than a live calculation, since viewers don't have their own
  OpenRouteService key: it works out the distance/time by comparing the
  tapped spot to your current position along the route data already being
  shared, so it's best for spots at or near your route line (it'll say if
  your tap landed well off of it) and won't show a place name the way your
  own tap does. The elevation shown to a viewer is the same kind of
  estimate (nearest point on the shared route), but the weather is a live,
  exact lookup either side can make directly — it needs no API key — so it
  loads in a moment after the rest of the popup appears.
- **Auto-follow** — the map recenters on your position as you drive, so you
  never have to nudge it back into view yourself. Drag the map to look
  around (check an upcoming turn, a nearby town, etc.) and auto-follow
  pauses — a blue **⌖ Recenter** button appears in the bottom-right corner;
  tap it to snap back to your position and resume following. Pinching or
  scrolling to zoom in/out never pauses it — only dragging the map does.
  Starting a new leg always begins back in auto-follow. Anyone watching
  your shared trip (section 7) gets the exact same behavior on their end —
  their map follows your live position, pauses the same way if they drag
  to look around, and gets the same Recenter button back.
- **Satellite / street map** — satellite by default, with both road names
  and place names layered on top (so satellite mode shows real street
  names, not just a bare aerial photo), switches to street view below
  40mph and back above 50mph, with a several-second delay to avoid
  flickering in stop-and-go traffic. Tap the button in the map's top-right
  corner to lock it to one style, or back to Auto. Anyone watching your
  shared trip gets the same street-name overlay on their map too, always
  on since their map has no satellite/street toggle of its own.
- **Full-screen map** — tap **⛶ Full Map** in the map's top-left corner to
  hide the turn banner, stats, and everything below and let the map fill
  the screen; tap **↙ Exit Full Map** in the same spot to go back to the
  normal split view.
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
  actually blocks your view of it. The closest 6 are also pinned directly on
  the map with an always-visible name/elevation label (tap the pin for
  distance and direction too), so you can match what you're looking at out
  the window to what's on screen.
- **Fuel Planner** — if you set your vehicle's range in Settings, this
  flags when the nearest known gas station ahead is farther than 80% of
  that range. It does not know your actual fuel level.
- **Daylight** — sunrise/sunset times and hours of daylight left at your
  current location.
- **Drive Timer** — tracks continuous driving time (based on GPS speed) and
  pops up a reminder at the interval you set in Settings.
- **Keeps your screen awake while navigating** — same trick Google Maps and
  other nav apps use, so a phone mounted in the car (especially one set to
  auto-lock on detected motion) doesn't dim or lock mid-drive. Turns on
  automatically the moment you calculate or resume a route and turns back
  off when you end the leg, so it's not draining battery at other times.
- **Share & Trip Log** (optional, needs one-time setup — see section 7) —
  tap **Start Sharing This Leg** to get a one-tap link (and a 6-digit
  passcode as a backup) to give to family. Tap **📤 Share Link** to send it
  straight through your phone's own Messages/email share sheet, or **📋
  Copy** to paste it yourself. Whoever you send it to just taps the link —
  it opens this app already on the "watching" screen with nothing to type
  in, no passcode, no navigating around. (The 6-digit passcode still works
  too, tucked under "Or give them the 6-digit passcode instead," for the
  rare case the link doesn't work for someone — they'd open this same web
  address, tap **Watch someone else's shared trip**, and enter it by hand.)
  Either way they end up seeing your route and a live-updating arrow at
  your position (rotated to your direction of travel — tap it for your
  current speed and heading, tucked behind a tap rather than an
  always-visible label so it doesn't sit on top of the route or the arrow
  itself), plus elevation and the weather right where you are, plus any
  photos/videos/comments you add — all without installing anything or
  creating an account. If you reroute mid-drive (whether you tapped **🔄
  Reroute** on the offer banner or it recalculated automatically), the blue
  route line on their map updates to match within moments too, with a
  quick note that it changed — they're never left watching your live
  position drift away from a route you're no longer actually following.
  Their status line also shows an estimated **Hours to go**, worked out
  from your shared route data the same way as the tap-for-ETA feature
  below. A collapsible **⛰ Mountains Nearby** section on
  their screen lists named peaks around your current position too — listed
  only, with no separate pins added to their map for it (unlike your own
  dashboard, which does pin the closest few), to keep their map, which
  already has your live position and every photo/comment pin on it,
  readable on a phone-sized screen. Use the 📷, 🎥, and 💬 buttons in this panel to drop
  a geotagged photo, video link, or comment; they show up as pins on both
  your map and every viewer's map. Each one is tagged with the GPS
  coordinates, temperature, and elevation at the moment you added it,
  shown right next to its timestamp in the trip log list and in its map pin
  (temperature comes from whatever "Weather Ahead" last fetched for your
  current spot — up to about 10 minutes old — rather than a fresh lookup
  every time, to keep this free and fast; entries added before this feature
  existed just won't show that line). Photos are automatically
  shrunk/compressed and stored right in the app to keep this feature
  entirely free (see section 7). Video works a little differently: record
  it with your phone's normal camera app, upload it to Google Drive (or
  wherever you like), set its sharing to "Anyone with the link," and paste
  that link in — the app never handles the video file itself, just the
  link, which is why it stays free too. While you're sharing, your own
  screen (and only your screen — see section 7b) also shows a **👀 X
  watching now** badge, so you know if anyone's actually got the trip open.
  Stopping somewhere overnight without ending the leg? Tap **⏸ Pause for
  the Night** — family sees a friendly "taking a break" message instead of
  a generic stale/no-update note, and it clears itself the next time you've
  driven a bit (or tap **▶ Resume Sharing** yourself); the link keeps
  working the whole time, nothing to resend. Tap **Stop Sharing** (or
  **New / End Leg**) when you're actually done for good — that turns off
  live position updates, but the same link/passcode keeps showing that
  leg's route, photos, and comments afterward (anyone can still open it,
  they just won't see your position move); see **My past trip logs**
  below for how you pull it back up yourself. Both **Stop Sharing** and
  **🏁 End This Leg** ask you to confirm before doing anything, specifically
  so a stray tap (reaching for the camera button, a bump in the road) can't
  cut off sharing or end a leg by accident — tap Cancel and nothing changes.
- **Naming the trip** — a **✏️** button next to the trip title at the top
  of this panel lets you set (or change) what this trip/leg is called, any
  time — before you start sharing, mid-drive, whatever. It's the same
  "Label this leg" text you can optionally type in when calculating a
  route; setting or changing it here keeps that, "My past trip logs," and
  what watchers see all in sync automatically. Leave it blank and your own
  screen just shows "Untitled trip" as a reminder it's not set; watchers
  simply see no title at all until you give it one.
- **Automatic state-crossing comments** — about a mile after your GPS
  crosses into a new US state, the app drops a comment for you: state name,
  nickname, capital, population, state bird/tree/flower, the date it joined
  the Union, its GDP and share of U.S. GDP, and which party currently
  controls that state's government (trifecta or divided). It's tagged with
  a distinct amber 🤖 icon (in the trip log and on the map) so it's obvious
  at a glance that it's system-generated, not something you typed. It's
  read aloud through voice guidance too — waiting for any in-progress turn
  instruction to finish first, never talking over it — and shows up for
  watchers exactly like your own comments do. Only fires while you're
  actively sharing a leg (nothing to attach it to otherwise), and only
  once you're a full mile past the actual state line, so ordinary GPS
  jitter or a route that briefly clips a neighboring state's corner won't
  fire a false one. The state facts and boundaries are bundled with the
  app itself (not fetched live), so this keeps working even with no signal
  right at the state line — population/GDP figures and which party
  currently governs are current as of when this was built and will drift
  slightly out of date over time (elections, new estimates). Both this and
  the city-crossing comment below start with "Just entered ___" when
  spoken.
- **Automatic city-crossing comments** — the same idea, for entering one
  of about 85 major, non-suburb US cities: city name, population, the year
  it was incorporated, its primary industry, and the current mayor and
  party (or "officially nonpartisan" where that's how the office actually
  works, which is true for most US cities). Tagged with a distinct blue
  🏙️ icon (different from the state comment's amber one) so the two are
  easy to tell apart at a glance, spoken the same waits-for-a-turn-to-
  finish way, and visible to watchers exactly like your own comments.
  Suburbs of a bigger neighboring city (Tempe/Mesa/Chandler/Scottsdale/
  Glendale/Peoria near Phoenix, Henderson/North Las Vegas near Las Vegas,
  and similar) are simply left out of the list entirely, so driving
  through one doesn't trigger its own separate announcement — only the
  metro's own principal city does, and in practice a suburb close to
  downtown usually falls inside that city's own trigger area anyway, so
  you still get told you've reached the metro area. Because reliably
  sourcing population/industry/incorporation-year/mayor for anywhere near
  all ~19,000 incorporated places in the US isn't realistic, this is
  intentionally limited to a curated list of major cities — most small
  towns along your route (this includes places like Page, AZ) won't
  trigger anything; only the state-crossing comment above is guaranteed to
  fire everywhere. Like the state comment, the city list and facts are
  bundled with the app (not fetched live) and are a snapshot as of when
  this was built.
- **Time zone lines + crossing alert** — dashed, labeled lines on both your
  map and every watcher's map mark the boundaries between the practical US
  time zones (Eastern, Central, Mountain, Mountain (Arizona), Pacific), so
  you can see at a glance which zone you're in and what's coming up.
  Crossing one — confirmed a mile past the line, same jitter-proofing as
  the state comment above — pops up an on-screen alert and reads it aloud,
  and tells you whether your clock actually needs to change *right now*,
  not just whether you crossed an official zone line: it compares the real
  current UTC offset of the old and new zone (via your browser's own time
  zone support) rather than just their names, because Arizona doesn't
  observe Daylight Saving Time and so for part of the year matches Pacific
  Time exactly despite being labeled "Mountain (Arizona)". Unlike the
  state/city trivia comments, this alert fires for you whether or not
  you're actively sharing a leg — your clock is about to change either
  way — but (like everything else in the trip log) it's only added there,
  for watchers to see, while you are sharing. Zone boundaries are bundled
  with the app (not fetched live), sourced from the official IANA time
  zone database, and — like the state boundaries — simplified for "which
  zone is this point in," not turn-by-turn precision. Scoped to the
  continental US; Alaska and Hawaii aren't included.
- **My past trip logs** (setup screen) — every leg you've ever started
  sharing shows up in a list here, most recent first, each with a **👀
  View** button that drops you straight into the exact same screen family
  sees from your link: the route, every photo and comment, and the same
  **⬇ Save** / **📤 Share** buttons on each photo. Handy for pulling a
  picture back up after you've already ended the leg, without having to
  dig up the passcode or ask whoever you sent it to. Collapsed by default
  (tap "Show past legs" to expand) since this can grow long over a
  multi-week trip. This list only lives in this one browser, not in the
  cloud, so it starts empty again if you clear this site's browser data,
  switch phones, or open the app somewhere else — the trips themselves are
  completely unaffected either way, still sitting in Firestore exactly as
  they were. There's an "Add" box at the bottom of the list for exactly
  that situation: paste in an old passcode or share link (checking texts
  you sent family is the easiest way to find one) and it gets listed again.
  Forgot to give a leg a name when you set it up (or just want to change
  it)? Tap **✏️** on any entry to name or rename it — the name replaces
  the plain date in the list. Tap **🗑** to remove an entry you don't need
  cluttering the list; that only tidies up this device's list, the actual
  trip log isn't touched, so you can always add the passcode back later.
  The same **✏️** rename option is on **Saved legs** too (the separate
  "Use as destination" list on the setup screen), for the same reason.
- **Messages from Family** — anyone watching your shared trip has a **💬
  Send a message** box right below their map on the watch screen. They type
  their name once (their phone remembers it after that) and a short
  message, tap **Send**, and it shows up in a **💬 Messages from Family**
  panel right below your own map — plus gets read aloud through voice
  guidance the moment it arrives. If you're mid-turn when it comes in
  (voice already speaking a turn instruction), it waits rather than
  talking over the turn, and quietly gives up on speaking that one after a
  few seconds if voice is still busy — either way, it's sitting in the
  panel to read whenever you glance down. This only shows up while you're
  actively sharing. Whatever name someone types is just that —
  self-reported, not verified — which is worth knowing but is normally a
  complete non-issue for a small group of family you already shared the
  link with.
- **Voice Reply** — every message in the Messages from Family panel has a
  **🎤 Reply** button. Tap it, speak your answer, and it's sent straight
  back to that one person — not everyone watching, just whoever sent that
  particular message — and shows up on their screen as a **🚗 Reply from
  the Traveler**, with a short spoken "Reply sent to [name]" confirmation
  on your end so you don't need to look at the screen to know it went
  through. There's nothing to type in the normal case: tap, talk, done.
  Voice input relies on your phone's browser having speech recognition
  built in — solid on Chrome (Android or desktop), historically spottier
  on Safari, which can also need an actual network connection to
  transcribe. Where it's not available at all, tapping **🎤 Reply** falls
  back to a quick one-line text prompt instead, so there's always some way
  to answer.

## 4. Troubleshooting

- **Checking you're on the latest version** — a small "Road Trip Navigator
  vYYYY.MM.DD" line appears at the bottom of the planning screen, in
  Settings, and on the watch screen (both the passcode-entry screen and the
  live view, so you can ask a family member to check theirs too without
  walking them through Settings). After uploading updated files, check this
  against the version mentioned in whatever update you just applied — if it
  still shows the old date, that's a stale cached copy, not a failed upload
  (see the caching entries below, and the automatic update-check banner
  that should also catch this for anyone who already has the app open).
- **Uploading an update — don't forget `version.json`** — every file update
  you upload should include an updated `version.json` (just one line:
  `{"version": "vYYYY.MM.DD.N"}`) that matches the new `APP_VERSION` in
  `app.js`. This is what powers the automatic update check below — everyone
  already running the app (you and anyone watching a shared trip) gets
  polled against this file every few minutes and whenever they switch back
  to the tab, and a small **🔄 A newer version is available** banner appears
  at the bottom of their screen with a **Reload Now** button if it's out of
  date. No more asking family what version they're on — if their banner
  never shows up, they're current. **Later** dismisses it for that one
  update (it'll come back if you ship another). Forgetting to update
  `version.json` doesn't break anything — it just means this particular
  check won't notice the new version exists.
- **Someone's banner never shows up even though they're clearly out of
  date** — the update-check code itself only exists starting with this
  version; a phone still running an even older copy has no way to know to
  ask. That's a one-time thing — have them force-refresh once (see the
  caching entries below) to get onto a version that includes the checker,
  and every update after that announces itself automatically from then on.
- **The update banner keeps showing up naming the same version you're
  already on, even after reloading** — two separate bugs, both now fixed:
  v2026.09.15.3 fixed the banner's *message* always printing your current
  running version instead of the actually-newer one it found; v2026.09.16.1
  fixed the actual *check* underneath, which used to treat "different at
  all" as "newer" — so a `version.json` that was momentarily stale (a CDN
  edge cache lagging a few minutes behind a fresh upload) or briefly showed
  an older number than what's running could trigger the same confusing
  loop, with Reload Now never making it go away since there was nothing
  actually newer to load. It now only fires for a version.json number that
  is genuinely, numerically greater than what's running (comparing the
  four `vYYYY.MM.DD.N` numbers in order), never merely different. If this
  still happens after updating to v2026.09.16.1 or later, open
  `version.json` directly in your browser (add `/version.json` to your
  site's URL) and compare what it says against the number in the app's own
  footer — if they're genuinely different, the upload of one of those two
  files didn't fully take; re-upload both together. A one-character typo in
  `version.json` (a hyphen instead of a period between the numbers, easy to
  introduce hand-editing it and easy to miss reading it back — they look
  nearly identical) used to cause exactly this too; v2026.09.16.2 made the
  check tolerant of either.
- **"Reload Now" doesn't actually change anything — the banner just comes
  right back** (the real fix landed in v2026.09.17.7) — this was the
  biggest one: the reload button only forced a fresh fetch of the HTML page
  itself. The `<script>`/`<link>` tags inside that page pointing at
  `app.js` and `style.css` had no cache-buster of their own, so the browser
  (and GitHub Pages' own CDN) were free to keep handing back a stale cached
  copy of the actual code under those unchanged URLs — you'd get a genuinely
  fresh page shell that then loaded the same old script, which still
  reported the same old version, which still saw a newer version.json,
  which asked you to reload again, forever. `index.html` now points at
  `app.js?v=<version>` and `style.css?v=<version>` instead of the bare
  filenames, so a real release is always a brand-new URL neither the
  browser nor GitHub Pages has ever cached — this can't come back as long
  as that `?v=` gets bumped alongside `APP_VERSION` and `version.json` on
  every future release (index.html has a comment marking exactly where).
  If you were stuck in this loop before updating past v2026.09.17.7: the
  very next "Reload Now" tap should break it on its own, since the
  cache-busted `index.html` fetch was already working correctly — it just
  didn't matter before, because everything past the page shell was stale.
  If it somehow still doesn't budge, clear the site's data in your phone
  browser's settings (or reinstall the home-screen icon) as a last resort
  — just know that also empties "My past trip logs" (see below), though
  none of the actual trips it pointed to are affected.
- **"My past trip logs" is completely empty/missing after clearing this
  site's data (or on a different phone/browser)** — expected, not a bug:
  that list is a local shortcut that only lives in the one browser it was
  built in, never in the cloud. Clearing site data, switching phones, or
  opening the app in a different browser all start it empty, but every
  trip it used to point to is completely unaffected — still sitting in
  Firestore exactly as it was, reachable the normal way through its
  passcode or share link. As of v2026.09.17.8, the panel stays visible
  even when the list is empty specifically so you have somewhere to paste
  an old passcode or link back in (the "Add" box at the bottom) rather
  than being stuck with no way back in short of digging through old texts
  for the exact right link to tap.
- **The update banner covers up the version footer at the bottom of the
  screen** — fixed in v2026.09.16.3. The banner floats over the page rather
  than pushing content up, so nothing previously made room for it; this
  only showed up in portrait (the banner's text wraps onto more lines at a
  narrower width, making it taller) and not landscape, which is why it was
  easy to mistake for something only some devices hit. It now measures its
  own height and pads the bottom of the page by exactly that much,
  re-checking automatically on rotation.
- **Turn-by-turn showed the wrong street/direction, even though the
  distance countdown was correct** — fixed in v2026.09.17.1. The distance
  was always measured to the right spot (the end of the road you're
  currently on), but the instruction text and voice announcement were
  pulled from the road you're already on rather than the one you're about
  to turn onto, so it read one turn stale — e.g. "Turn right in 280 ft"
  when the upcoming turn was actually a left, because that was the
  direction of the turn you'd already made. Now the instruction and the
  distance both point at the same upcoming turn.
- **Turn-by-turn announced a "keep right" that had already passed instead
  of the actual upcoming turn, at a highway interchange, even though the
  distance countdown looked right and the full turn-by-turn list further
  down had the correct turn listed** — fixed in v2026.09.19.2, a different
  root cause than the one above. Every GPS fix finds "the nearest point on
  the route" by checking the whole route's geometry — fine almost
  everywhere, but at a complex interchange, an off-ramp or loop can pass
  back within a few dozen feet of an earlier stretch of the same highway,
  and that earlier point can measure as geometrically closer than the
  correct point you're actually driving toward. When that happened, the
  app kept reporting an already-completed maneuver as if it were still
  upcoming, while the distance kept counting down normally (both points
  were moving forward together, just the wrong one was being announced) —
  which is exactly backward from a genuinely useful warning and can cause
  a real missed turn. It now only searches for the nearest point in a
  window around wherever it last confirmed you were, rather than the whole
  route, so an earlier, coincidentally-nearby stretch of road can't win out
  over the correct, further-along point you're actually on; it still falls
  back to a full-route search if nothing in that window is close enough
  (the first GPS fix of a leg, or after a real wrong turn takes you well
  off the route).
- **A spoken turn instruction still arrived right as I was passing the
  turn (or already on the exit ramp), driving fast on an interstate** —
  improved in v2026.09.20.2, a different cause than the interchange bug
  above. The "heads up" and "right now" announcements used to fire at the
  same fixed distance (about 1 mile, then about a quarter mile) no matter
  your speed — a quarter mile is roughly 30 seconds of warning at 30mph,
  but only about 11 seconds at 80mph, so the faster you were going, the
  less real warning time you actually got, backwards from what you'd want.
  Past 60mph, both distances now grow with your actual speed so they hold
  steady at about a minute and about 15 seconds of warning no matter how
  fast you're driving, instead of shrinking. Below 60mph nothing changes —
  you were already getting more than that much warning at ordinary speeds.
  Separately: if the instruction itself says something generic like "Keep
  right" for what's actually an interstate exit, rather than "Take the
  exit ramp," that wording comes straight from OpenRouteService (the free
  routing service this app uses) — it classifies a highway exit as the
  same kind of maneuver as an ordinary lane fork and doesn't have a
  distinct "take the exit" phrase in its vocabulary the way a paid service
  like Google or Apple Maps does. The distance countdown to it is still
  accurate; the wording just isn't always as specific as you'd get from a
  paid map. Let me know if this keeps causing missed turns even with more
  warning time, and I can look at whether there's a reliable way to detect
  "this fork is actually an exit ramp" and say so explicitly.
- **The "Full turn-by-turn" list fought attempts to scroll down and read
  ahead** — fixed in v2026.09.19.2. It used to re-scroll itself back to the
  current turn on every single GPS update (every few seconds), whether or
  not the current turn had actually changed, which felt like it was
  constantly yanking you back while you tried to look further down the
  road. It now only rebuilds/re-scrolls when the current turn genuinely
  advances (or a new route loads) — scrolling around in between is never
  interrupted.
- **Voice guidance stopped working, even though it's worked before and
  "Enable Voice Guidance" is checked** — as of v2026.09.17.2, tapping
  Enable Voice Guidance (or turning the 🔊 toggle back on) now speaks an
  actual audible test phrase immediately, so you find out on the spot if
  it's silent rather than an hour into a drive, and any failure now shows a
  toast instead of failing silently. The most common actual cause turned
  out to be the phone's screen locking mid-drive (see the next bullet,
  fixed as of v2026.09.17.3) — a locked/backgrounded tab is also what let
  Android Chrome's speech engine quietly wedge itself shut with no error
  and no sound, ever again until a full page reload; this build now also
  periodically nudges the speech engine in the background to keep that from
  happening on its own. If you still get no sound after all that: check
  your phone's media volume (not ringer volume — voice guidance plays
  through the same channel as music/podcasts, and if Bluetooth was
  connected to the car, that volume is separately controlled by the car);
  on iPhone, the physical mute switch silences it same as any app.
- **Phone screen dims or locks while navigating** — fixed as of
  v2026.09.17.3: the app now keeps the screen awake automatically the whole
  time you have an active route, the same way Google Maps does, so a phone
  mounted in the car (including one set to auto-lock on detected motion)
  should no longer time out mid-drive. It turns itself off again once you
  end the leg. If you'd tweaked your phone's own display-timeout or
  motion-lock settings to work around this before, you can safely put those
  back — though there's no harm leaving them as a backup. This only holds
  the screen awake while this browser tab is the one actively in front of
  you; switching to another app, or manually pressing the power button,
  still locks the phone same as always.
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
- **Search only offers a street/city match, not the exact address** — the
  free map data behind search doesn't have every U.S. address on file,
  especially newer or rural ones. Pick the closest match and use the
  drag-the-pin step that appears afterward to correct it by hand; the
  route uses wherever the pin ends up, not the original text match.
- **No address at all for a spot (a trailhead, campsite, backcountry
  turnoff)** — type the coordinates straight into the Starting point or
  Destination box instead, like `34.5625, -112.2867` (a few formats work:
  with or without the comma, and with N/S/E/W letters instead of a minus
  sign, like `34.5625 N, 112.2867 W`). The app recognizes it immediately —
  no address search needed — and drops a draggable pin so you can nudge it
  to the exact spot if needed.
- **Search can't find a small local business, or a street intersection** —
  search here is built on OpenStreetMap, which reliably has well-known
  chains and most addresses but is hit-or-miss on independent local
  businesses, and its address parser doesn't understand "Main St & Gurley
  St" style intersection queries at all. For either case, find the spot in
  Google Maps instead (much better small-business coverage, and it handles
  intersections fine) and paste its link straight into the Starting point
  or Destination box — a long `google.com/maps/...` or `maps.google.com/...`
  link works and drops the pin exactly there. A short link from the phone's
  Share button (`maps.app.goo.gl/...`) can't be read this way — open it once
  in any browser tab first, which turns it into the long link, then paste
  that one instead.
- **Starlink/cellular brief dropouts** — the app will show stale/error
  states briefly and recover automatically once the connection returns;
  your route and progress tracking don't require a constant connection
  since your position is compared against the already-downloaded route.
- **Overpass (points of interest / peaks) slow or failing** — this uses a
  shared free public server (overpass-api.de) that occasionally rate-limits
  under heavy global usage; it will retry automatically on the next cycle.
- **"Share & Trip Log" says "Not set up yet"** — you (or whoever set up this
  copy of the app) haven't filled in `firebase-config.js` yet; see section 7.
  This is entirely optional and everything else in the app works without it.
- **A viewer gets "No trip found with that passcode"** — either the code was
  mistyped, sharing was already stopped, or the trip's passcode was
  regenerated (each time you tap **Start Sharing** you get a new one — send
  the latest code, not an old one). The same goes for the shareable link —
  it has the passcode baked into it, so an old link stops working the same
  way an old passcode would; always send the current one shown in the app.
- **The "Resume Trip" banner didn't show up after reopening the app** —
  it only appears on the same phone/browser that was running the trip
  (this data never leaves your device), and only if you didn't tap **End
  Leg** before closing — that intentionally clears it, since the leg's
  genuinely finished at that point.
- **"Couldn't reconnect the share link from before" after tapping Resume
  Trip** — rare; means the old trip's data is no longer reachable (for
  example, it was manually removed in the Firebase console). Your route
  and progress still resume fine — just tap **Start Sharing This Leg**
  again for a new link.
- **"📤 Share Link" doesn't do anything, or there's no share popup** — some
  browsers (mostly on desktop) don't offer that share-sheet feature; tap
  **📋 Copy** instead and paste the link into your text/email app by hand.
- **Accidentally hit Stop Sharing or End This Leg** — as of v2026.09.20.1,
  both buttons now ask "Are you sure?" before doing anything, specifically
  so a stray tap (a bump in the road, reaching for the camera button while
  a passenger is trying to grab a photo) can't cut off sharing or end a leg
  with no way to catch it. Tap Cancel on the popup and nothing happens —
  sharing/the leg continues exactly as it was.
- **"Photo is too large to fit even after compression"** — very rare; means
  the app shrank the photo as far as it reasonably can and it still won't
  fit. Try a different photo, or a screenshot of it, instead.
- **There's no "upload video" button** — intentional; see section 7 for why.
  Use the **🎥 Video Link** button instead — it links out to a video you've
  already uploaded to Google Drive rather than uploading through the app.
- **Video thumbnail doesn't show, just a 🎥 icon** — this happens if the
  Drive link's sharing isn't set to "Anyone with the link" (Drive won't
  serve a public thumbnail for a restricted file), or the link isn't a
  standard Drive share link. Tapping it still opens the video in Drive
  either way — double-check the sharing setting if you want the preview
  image too.
- **Tapping the map for an ETA says "Couldn't find a route there"** — same
  causes as any routing error (API key issue, or that spot genuinely isn't
  reachable by road, like the middle of a lake or a private tract with no
  mapped access).
- **Route still used the interstate even with a back-roads setting on** —
  check Settings → Route preference actually saved (it resets to "Fastest
  route" only if you've never set it). With "Prefer back roads if it's not
  much slower," a toast after each route calculation says whether it picked
  back roads or the fastest route and why — if it says the back-roads route
  was too much slower, raise the extra-minutes tolerance in Settings. With
  either back-roads option, a short unavoidable stretch of highway can still
  appear if that's genuinely the only road available there.
- **The reroute offer isn't showing up when I go off-route** — it only
  triggers once you're about half a mile from the calculated route (normal
  GPS wobble near an interchange or wide intersection isn't enough), and it
  won't ask again for the same detour once you've already tapped "Keep
  Going This Way" for it — look for the small 🔄 chip near the map instead.
  Also check Settings → "When you go off the planned route" is set to "Ask
  me first" rather than "Reroute automatically" (which recalculates with no
  prompt at all, by design).
- **The reroute offer popped up while I was clearly still on the route**
  (fixed in v2026.09.17.4) — this came from how off-route distance was
  being measured: it checked distance to the nearest recorded point on the
  route line, but on a long, dead-straight rural highway those points can
  be a mile or more apart (the route only gets a point where the real road
  actually bends), so sitting in the middle of one of those stretches could
  measure as "half a mile off route" even while driving right down the
  center of it. It now measures distance to the nearest point anywhere
  along the route line, not just the nearest recorded point, which is what
  the false triggers on long straight stretches were about. One related fix
  alongside it: accepting a reroute (or having one happen automatically)
  used to re-zoom your own map, and every watcher's map, down to just the
  new remaining route — which is almost certainly what looked like your
  earlier photos and comments had been "cut off": they're still there (a
  reroute never touches the trip log), just outside the newly-zoomed view.
  A reroute no longer re-zooms anyone's map at all, only the very first
  route calculation does.
- **Can a viewer save or share the photos themselves, or only the driver?**
  — they already can, with the exact same buttons: every photo in the trip
  log (both in the scrolling list and in its map pin popup) has its own
  **⬇ Save** and **📤 Share** buttons, whether you're looking at it as the
  driver or someone's looking at it through your share link — it's
  literally the same code rendering it either way. No screenshot/screen
  clip workaround needed. If a photo doesn't have those buttons, tapping it
  first opens a bigger view (a lightbox) that has its own Save/Share row at
  the bottom.
- **"My past trip logs" has way more entries than legs I actually
  shared** (fixed in v2026.09.17.6) — resuming a leg (via the "Resume
  Trip" banner after any reload, which includes every app-update reload)
  was mistakenly re-recording that same trip as a brand-new entry each
  time, rather than recognizing it as one already on the list. A day with
  several reloads — a handful of app updates, say — could rack up several
  duplicate entries for what was really just one or two actual "Start
  Sharing" taps. It now recognizes a trip it's already seen and leaves the
  list alone; it also quietly cleans up any duplicates already sitting in
  the list from before this fix, the next time the list loads.
- **A viewer's tap-for-ETA looks off, or says the tap is far from the
  route** — expected once the tap lands well away from your route line;
  viewers estimate off the route data already shared with them rather than
  running a live route calculation (no ORS key on their end), so it's most
  accurate right on or very near your path. Your own tap (as the driver)
  always calculates live and works anywhere, on-route or off.
- **No weather shows up in a tap-for-ETA popup** — the weather line loads a
  moment after the rest of the popup, so give it a second; if it never
  appears, the tapped spot is most likely outside the US (the National
  Weather Service only covers the US and its territories), or there was a
  network hiccup. Nothing else in the popup is affected either way.
- **A viewer gets "Couldn't send: Missing or insufficient permissions"
  sending a message** — your Firestore rules need the new `messages` block
  added; see section 7b's note about updating existing rules.
- **A viewer's message shows as sent, but your own screen still says "No
  messages yet"** — two different things can cause this, and they look
  identical from the sender's side:
  - Your Firestore rules are fine but out of date in one specific way: the
    viewer's *write* succeeded, but your phone's *read* of that same
    collection is being denied, so it never reaches your screen at all.
    You should now see a **"Messages sync error: …"** toast on your own
    screen when this happens (an earlier version of this feature swallowed
    that error silently, which is exactly what made this confusing to
    track down in the first place) — if it names a permissions error,
    re-paste the full rules block from section 7b and **Publish**.
  - More likely: the message was sent to a share link/passcode that wasn't
    the *current* one — for example, sharing got stopped and restarted
    (a fresh **Start Sharing** always issues a new passcode/link) between
    when the viewer got their link and when they actually sent something,
    so it landed in a trip nobody's listening to anymore. The rules now
    require a trip to still be **active** to accept a new message, so this
    case fails with a clear **"This trip isn't active right now — ask for
    a fresh link"** on the sender's screen instead of silently vanishing —
    but that only takes effect once you've re-published the rules block
    from section 7b with that condition included. The fix either way: make
    sure whoever's testing is using the passcode/link currently showing on
    your own Share & Trip Log panel, not one from an earlier test.
- **A family member got told they "didn't have the authority" (or a raw
  "Missing or insufficient permissions" error) trying to send a message,
  even though the trip looked active** — fixed in v2026.09.19.3. There's
  always been a friendly pre-check that catches a stopped/stale trip before
  it ever reaches Firestore (see the "This trip isn't active right now" bullet
  above), but it relies on this device's own last-received copy of the trip's
  status — if that phone's connection hiccupped for a moment right as the
  trip's status changed (the traveler ended that leg, or started a fresh one
  with a new link, right around when the message was being sent), the
  pre-check could still see the old "active" state, let the attempt through,
  and then get the confusing raw permissions error back from the server
  instead of a plain-English one. The app now also catches that specific
  error directly and shows the same friendly "This trip isn't active right
  now — ask for a fresh link" message either way, so this can't slip through
  as a mysterious authorization failure again. The most common actual cause
  is simply an old/expired link or passcode being used — check that whoever
  hit this was using the current one shown on your own Share & Trip Log
  panel, not one from an earlier leg.
- **The blue route line covers up road names/numbers on the map** — a first
  pass in v2026.09.19.4 made the line thinner and semi-transparent, which
  helped some but still left a highway shield sitting right on the route
  hard to read (a see-through blue wash over it isn't the same as it being
  uncovered). v2026.09.19.6 fixes the actual cause in satellite mode: the
  route line was always drawn in the same
  layer Leaflet uses for anything drawn "on top" of the map, above every
  map tile no matter the order they were added in — so no amount of making
  the line thinner or more see-through could stop it from sitting over
  whatever was directly underneath it. The route now draws in its own layer
  positioned *underneath* the street-name/highway-shield layer instead, on
  both your map and every watcher's, so those labels are always fully
  legible above the route line, regardless of the line's own thickness. It
  also let the line go back to being fully clear and easy to follow, since
  it no longer needs to be washed out to keep labels visible. This applies
  in satellite mode; the plain street map (used automatically below 40mph)
  uses a single street image with names baked directly into it, so there's
  no separate label layer to draw the route beneath there — that view
  already showed street names clearly without a satellite-style road
  overlay to conflict with in the first place.
- **A message showed up in the panel but wasn't read aloud** — either voice
  guidance itself is off (check the 🔊/🔇 icon in the top bar), or it was
  still busy reading an actual turn instruction when the message arrived
  and stayed busy long enough that it gave up trying — the message is still
  right there in the panel either way, nothing was lost.
- **Tapping 🎤 Reply does nothing, or immediately shows an error about the
  microphone** — your browser is either blocking mic access for this site
  (check its site permissions and allow Microphone, same as the location
  permission prompt) or doesn't support voice input at all, in which case
  it should have fallen back to a text prompt instead — if it silently did
  neither, try reloading first in case that's a stale-cache issue (see the
  version-check entries above).
- **"Couldn't send reply: Missing or insufficient permissions"** — your
  Firestore rules need the `replies` block added; see section 7b.
- **You replied, but it doesn't show up on their screen (they get a "Reply
  sync error")** — same shape of issue as the messages one above: their
  read of the `replies` collection is being denied. Re-check that the full
  rules block from section 7b (all five `match` sections) got published,
  not just part of it.
- **Voice reply transcribed the wrong words, or nothing at all** — normal
  speech-recognition limitations (accent, road noise, weak connection on
  Safari, which can need network access to transcribe) — just tap 🎤 Reply
  again and try once more.
- **A state (or city/time-zone) crossing comment didn't show up, right
  around when a photo was taken** — improved in v2026.09.19.5. Taking a
  photo through the phone's camera can background this browser tab, and on
  some phones a backgrounded tab gets its memory reclaimed and silently
  reloaded the moment you switch back to it — which, if it happens to land
  right as you cross a state/city/time-zone line, used to make the app
  quietly (and correctly, for an ordinary reopen) treat wherever you land as
  "where you started," with no announcement for the crossing that had just
  happened. The app now remembers the state/city/zone it last confirmed you
  in and carries that forward through exactly this kind of reload, so once
  you've driven a bit further the crossing still gets caught, announced, and
  logged — just a little later than usual, rather than not at all. This
  can't help a crossing missed before this version shipped, only ones going
  forward.
- **No automatic state-crossing comment showed up** — it only fires while
  you're actively sharing a leg (nothing to attach a comment to otherwise,
  same as manual comments), and only once you're a full mile past the
  actual state line, so check the trip log a little further along before
  assuming it's missing. It's also a once-per-crossing thing per page
  load — reloading the app mid-drive re-learns the state you're currently
  in silently (no announcement for wherever you happen to reload), then
  resumes announcing normally from the next new state onward.
- **A state's population/GDP/government-control fact looks out of date** —
  those three change over time (new estimates, elections); everything else
  (capital, bird, tree, flower, nickname, statehood date) doesn't. The
  figures are bundled with the app as of when a given version was built,
  not fetched live, so they'll drift slightly stale between updates —
  that's expected, not a bug, though let me know if one looks meaningfully
  wrong and I'll correct the underlying data.
- **No automatic city-crossing comment showed up** — the same "actively
  sharing" requirement as states applies, plus this only covers a curated
  list of about 85 major, non-suburb US cities (see the feature bullet
  above) — most small and mid-size towns along your route simply aren't in
  it and won't trigger anything; that's the intended scope, not a bug.
  It also uses a circular "roughly within city limits" area (built from
  the city's land area) rather than its real, often irregular municipal
  boundary, since bundling exact boundaries for that many places isn't
  practical — so it can fire a little before or after you'd cross an
  actual city-limit sign, especially for oddly-shaped or very spread-out
  cities.
- **A city's population/mayor/party/industry fact looks off, or a suburb
  got its own separate announcement** — population and the current
  mayor/party are the two that go stale over time (new estimates,
  elections — mayoral terms are short and change more often than
  governors, so this one drifts faster than the state data); primary
  industry and incorporation year don't. If a suburb announced separately
  from its main city, or a city you'd expect to see doesn't trigger at
  all, that's the curated list's boundaries — let me know and I can adjust
  either the include/exclude list or a city's circle size.
- **No time zone crossing alert showed up** — unlike the state/city
  comments, this one isn't tied to active sharing, so check first whether
  voice guidance is actually on (Settings) if you expected to hear it —
  the on-screen toast should still have appeared either way. Same
  once-per-crossing-per-page-load behavior as the state comment: reloading
  the app mid-drive silently re-learns whatever zone you're in at that
  moment (no alert for it), then resumes alerting normally from the next
  new zone onward. And like the other two, it needs a full mile confirmed
  past the line before firing, so check a little further along the road
  first.
- **The time zone alert said the clock isn't changing, but I definitely
  crossed a zone line** — that's expected specifically around Arizona: it
  compares the real current UTC offset of the old and new zone, not just
  their names, and for part of the year (whenever Pacific Time is
  observing Daylight Saving) Arizona's "Mountain (Arizona)" zone has the
  exact same offset as Pacific. The alert is telling you the clock
  genuinely doesn't need to move right now, not misdetecting the
  crossing.

## 5. Known limitations (by design, given free/no-cost data sources)

- No live traffic congestion or accident data (no free nationwide source
  exists) — road conditions are weather-based only.
- "Mountains nearby" is a distance-based list, not verified visibility.
- Time zone lines/alerts are scoped to the continental US (Alaska and
  Hawaii aren't included), and the boundary lines are simplified for
  "which zone is this point in," not drawn to exact survey precision.
- Fuel planner uses a manually-set range, not real fuel-level telemetry.
- Everything requires an internet connection (Starlink, WiFi, or cellular)
  to fetch new routes, weather, and points of interest; there's no offline
  map mode.
- Keeping both satellite and street tiles loaded at all times (for instant,
  stutter-free switching) uses somewhat more mobile data than a single map
  style would — worth knowing if you're on a limited cellular data plan as
  a backup to Starlink.
- Trip sharing has no login for viewers by design (that's what makes it
  zero-setup for family) — anyone who has the current 6-digit passcode (or
  the link, which has that same passcode built into it) can watch that trip.
  Passcodes/links are random and change every time you start sharing, and
  only your own phone (tied to a private key Firebase generates the first
  time you use this feature) can ever post location/photos/videos/comments
  as you, but treat the link or passcode itself like a house key: share it
  only with people you trust. **Stop Sharing only turns off live position
  updates** — it does not revoke the passcode/link. Anyone who has it can
  still open that trip's route, photos, and comments at any time afterward
  (this is intentional — see **My past trip logs** — but it means Stop
  Sharing isn't a way to lock someone out who already has the passcode).
- Voice reply depends on your browser's built-in speech recognition, which
  is inconsistent across browsers — reliable on Chrome, historically
  spottier on Safari (and can require an actual network connection to
  transcribe, not guaranteed on the road). Where it's unavailable, replying
  falls back to a one-line text prompt.

## 6. Running it on a PC instead of a phone (optional)

A phone using its own GPS is still the recommended way to use this app.
If you'd rather run the bigger screen of a Windows/Mac/Linux PC and feed it
location from a phone instead, see the **`pc-relay`** folder — it's a
small, separate add-on with its own setup steps. Once it's running, choose
"Phone via local relay" as the Location source in the main app's Settings
and point it at the relay's address. Everything else about the app works
exactly the same either way.

## 7. Setting up trip sharing (optional)

This powers the **📡 Share & Trip Log** panel on the dashboard: a passcode
you give to family so they can watch your live position, photos, videos,
and comments, without installing anything or making an account. It needs a
free **Firebase** project (Google's app-backend service) — about 10 minutes
of one-time setup, done once by whoever is hosting this app (you). Skip
this whole section if you don't want that feature; everything else in the
app works fine without it.

This deliberately uses only **Firestore** (Firebase's database), not
**Firebase Storage**. Google now requires the paid, pay-as-you-go "Blaze"
plan just to turn Storage on, even though ordinary usage stays within its
free quota — it's not something this app needs, so it's skipped entirely.
Photos are shrunk and compressed right on your phone and saved as text
inside Firestore itself, which stays on the truly free "Spark" plan, no
credit card ever required. A video clip doesn't fit in a database document
even compressed, though, so video works differently: the **🎥 Video Link**
button doesn't upload anything — it saves a link to a video you've already
put on Google Drive (shared as "Anyone with the link"), which is just a
short piece of text and costs nothing either.

### 7a. Create the Firebase project

1. Go to **console.firebase.google.com**, sign in with any Google account,
   and click **Create a project** (or **Add project**). Give it any name
   (e.g. "roadtrip"). You can decline Google Analytics when asked — not
   needed here.
2. Once it's created, on the project overview page click **+ Add app**,
   then pick the **`</>`** (Web) icon from the platform choices that appear.
   Give it a nickname (e.g. "navigator") and click **Register app**. You do
   *not* need Firebase Hosting — you're already using GitHub Pages/Netlify
   for that.
3. Firebase shows a code block containing a `firebaseConfig = { ... }`
   object. Open **`firebase-config.js`** from this download in a text
   editor, and copy your actual `apiKey`, `authDomain`, `projectId`,
   `storageBucket`, `messagingSenderId`, and `appId` values in, replacing
   the `"YOUR_..."` placeholders. (Yes, copy `storageBucket` too even though
   Storage itself won't be turned on — it's just part of the standard config
   block and harmless to leave in.) Save the file.

   **This file is yours to keep.** It's kept separate from the rest of the
   app on purpose: future updates to `index.html`, `app.js`, `style.css`,
   or this README won't touch `firebase-config.js`, so filling it in once
   here is permanent — you won't need to re-enter these values again.
   (`firebase-config.sample.js` is just a reference copy of the same
   template with the setup instructions; the app doesn't load it and it
   doesn't need to go in your repo.)

### 7b. Turn on the two Firebase features this uses

Both in the Firebase console's left sidebar, under **Build** — and both
free, no billing/Blaze plan needed:

1. **Authentication** → **Get started** → under "Sign-in method," choose
   **Anonymous** → toggle **Enable** → **Save**. (This lets the app quietly
   recognize "your phone" vs. "a viewer's phone" behind the scenes, with no
   sign-up or password for anyone.)
2. **Firestore Database** → **Create database** → choose **Start in
   production mode** → pick any nearby location → **Enable**. Once created,
   go to its **Rules** tab, delete what's there, paste in the block below,
   and click **Publish**:

   ```
   rules_version = '2';
   service cloud.firestore {
     match /databases/{database}/documents {
       match /trips/{pin} {
         allow read: if request.auth != null;
         allow create: if request.auth != null
                       && request.resource.data.ownerUid == request.auth.uid;
         allow update: if request.auth != null
                       && resource.data.ownerUid == request.auth.uid;
         allow delete: if false;

         match /events/{eventId} {
           allow read: if request.auth != null;
           allow create: if request.auth != null
             && get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid;
           allow update: if false;
           allow delete: if request.auth != null
             && get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid
             && resource.data.expiresAt is timestamp
             && resource.data.expiresAt < request.time;
         }

         match /viewers/{viewerId} {
           allow read: if request.auth != null
             && get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid;
           allow create, update: if request.auth != null && request.auth.uid == viewerId;
           allow delete: if request.auth != null && request.auth.uid == viewerId;
         }

         match /messages/{messageId} {
           allow read: if request.auth != null
             && (get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid
                 || request.auth.uid == resource.data.senderUid);
           allow create: if request.auth != null
             && get(/databases/$(database)/documents/trips/$(pin)).data.active == true
             && request.resource.data.senderUid == request.auth.uid
             && request.resource.data.text is string
             && request.resource.data.text.size() > 0
             && request.resource.data.text.size() <= 300
             && request.resource.data.senderName is string
             && request.resource.data.senderName.size() <= 40;
           allow update: if false;
           allow delete: if request.auth != null
             && get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid;
         }

         match /replies/{replyId} {
           allow read: if request.auth != null
             && (get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid
                 || request.auth.uid == resource.data.toUid);
           allow create: if request.auth != null
             && get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid
             && request.resource.data.toUid is string
             && request.resource.data.text is string
             && request.resource.data.text.size() > 0
             && request.resource.data.text.size() <= 300;
           allow update: if false;
           allow delete: if request.auth != null
             && get(/databases/$(database)/documents/trips/$(pin)).data.ownerUid == request.auth.uid;
         }
       }
     }
   }
   ```

   **Already set this up before?** Go back to Firestore Database →
   **Rules**, replace what's there with the full block above (all five
   `match` blocks — `trips`, `events`, `viewers`, `messages`, `replies`),
   and **Publish** again whenever this block changes from a version you
   already pasted in — nothing else needs to change, and your existing
   trip data, photos, and viewers are untouched either way. Two things this
   block currently does that an older paste of it might not yet:
   - The `messages` and `replies` sections themselves are what let family
     send you messages and let you voice-reply to one of them specifically
     (see section 3) — without them, sending/replying fails with a
     permissions error, though everything else in the app keeps working.
   - The `messages` block's `create` rule requires the trip to still be
     `active`, so a message sent to a stopped/stale share link fails
     loudly (the sender sees an error) instead of silently writing into a
     trip nobody's listening to anymore — which otherwise looks exactly
     like "it sent, but you never got it."

This rule means: only your own phone (recognized by a private key Firebase
generates the first time you use this feature) can ever start a trip,
update its location, or add photos/comments to it; anyone signed in (which
happens automatically and invisibly, including for viewers) can read a trip
they know the passcode for; nobody can overwrite anything, and the only
thing anyone can ever delete is one of your own photos, and only once its
90-day expiration date has actually passed (see 7d) — everything else is
permanent unless you remove it yourself in the Firebase console. The new
`viewers` block backs the "👀 X watching now" count you see while sharing
(section 3): each viewer's phone can only ever write its own single
presence marker there, and — this is the important part — only **your**
phone (the trip's owner) is allowed to read that whole list at all, so
there's no way for a viewer to see who else is watching, or even how many,
by any means (this is enforced by Firebase itself, not just hidden in the
app's screen).

### 7c. Upload and use it

Upload the edited `firebase-config.js` to your GitHub repo alongside
`index.html`, `app.js`, and `style.css` (same folder). Reload the app — the
**📡 Share & Trip Log** panel on the dashboard should now offer **Start
Sharing This Leg** instead of "Not set up yet." That's it; no further setup
is needed for the people you share the passcode with, and no credit card is
needed anywhere in this flow.

**Free tier note:** Firebase's free "Spark" plan includes far more Firestore
reads/writes than a two-week trip with a handful of family watching will
use (50K reads + 20K writes/day, 1GB of stored data) — no billing account
is attached to your project at all, so there's nothing to be charged for.
Each shared photo does count against that 1GB (compressed to roughly
100–700KB each), which is still room for hundreds of photos across the trip.

### 7d. Automatic photo cleanup

Nothing in Firestore deletes itself on its own by default. Google Cloud
does offer a built-in "TTL policy" feature for exactly this, but setting
one up requires a permission level in Google Cloud Console (separate from
the Firebase console) that isn't included by default even for the owner of
a brand-new free project — so instead, this cleanup is built directly into
the app, and needs nothing extra set up beyond the security rule in 7b
above.

Here's how it works: every photo you add gets tagged with an `expiresAt`
field, 90 days out. Each time you open the app (at most once a day, so it's
not re-checking constantly), it quietly looks back through the list of
trips *this phone* has ever shared, and deletes any photo whose 90 days is
up. This can only ever run from a phone that knows the private key
Firebase generated for it when sharing first started (the same thing that
lets it write to a trip in the first place) — nobody viewing your trips can
trigger it, and it can't touch anyone else's data.

**What this does and doesn't touch:**
- Only **photos** expire this way (the large base64 image data). Comments
  and video links are tiny text and are kept forever.
- The trip's route line, label, and passcode (the `trips/{pin}` document
  itself) are never touched — only individual expired photo documents
  inside it.
- The **Saved legs** list on the setup screen ("Use as destination" for a
  previous address) is completely separate — it lives only in this
  phone's local storage, was never stored in Firestore, and is
  unaffected by any of this.
- Because it tracks trips per-phone (in local storage), a trip shared from
  a phone whose storage later gets cleared won't be revisited for
  cleanup — it'll just sit there, same as before this feature existed.
  That's a minor gap, not a risk: nothing is deleted incorrectly, some
  old photos just don't get swept up automatically in that edge case.
