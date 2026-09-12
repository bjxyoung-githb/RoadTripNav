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

Each day of the trip, just reopen the bookmark and enter that day's
destination as a new leg — previous legs are saved on your phone and
listed so you can quickly reselect a place you've already routed to.

## 3. What each part does

- **Route & turn-by-turn** — calculated by OpenRouteService; the map shows
  your route, your live position, and the full step list with the current
  step highlighted. Spoken prompts announce each turn about a mile ahead
  and again right before it. If you drift off the calculated route, it
  automatically recalculates (and says so out loud). The route can only end
  on a road the map data marks as drivable — if your exact pin sits on a
  private complex/HOA road or similar that isn't mapped that way, the route
  will stop at the nearest public road instead. When that gap is more than
  about 500 feet, a 🏠 pin marks your actual destination separately from
  the blue route-end marker, with a warning banner, so you know you'll need
  to finish the last stretch on foot or by eye rather than being silently
  routed somewhere else.
- **Miles left / ETA / speed** — computed from your live position against
  the route, refreshed continuously as your phone reports new GPS fixes.
- **Satellite / street map** — satellite by default (with labels layered
  on top), switches to street view below 40mph and back above 50mph, with
  a several-second delay to avoid flickering in stop-and-go traffic. Tap
  the button in the map's top-right corner to lock it to one style, or
  back to Auto.
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
- **Share & Trip Log** (optional, needs one-time setup — see section 7) —
  tap **Start Sharing This Leg** to get a 6-digit passcode. Anyone you give
  it to can open this same web address, tap **Watch someone else's shared
  trip**, enter the code, and see your route and a live-updating arrow at
  your position (rotated to your direction of travel, with your current
  speed/heading and the weather right where you are), plus any
  photos/videos/comments you add — all without installing anything or
  creating an account. Use the 📷, 🎥, and 💬 buttons in this panel to drop
  a geotagged photo, video link, or comment; they show up as pins on both
  your map and every viewer's map. Photos are automatically
  shrunk/compressed and stored right in the app to keep this feature
  entirely free (see section 7). Video works a little differently: record
  it with your phone's normal camera app, upload it to Google Drive (or
  wherever you like), set its sharing to "Anyone with the link," and paste
  that link in — the app never handles the video file itself, just the
  link, which is why it stays free too. Tap **Stop Sharing** (or **New /
  End Leg**) when you're done; the passcode stops working.

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
- **Search only offers a street/city match, not the exact address** — the
  free map data behind search doesn't have every U.S. address on file,
  especially newer or rural ones. Pick the closest match and use the
  drag-the-pin step that appears afterward to correct it by hand; the
  route uses wherever the pin ends up, not the original text match.
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
  the latest code, not an old one).
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
- Trip sharing has no login for viewers by design (that's what makes it
  zero-setup for family) — anyone who has the current 6-digit passcode can
  watch that trip while it's active. Passcodes are random and change every
  time you start sharing, and only your own phone (tied to a private key
  Firebase generates the first time you use this feature) can ever post
  location/photos/videos/comments as you, but treat the passcode itself like a
  house key: share it only with people you trust, and tap **Stop Sharing**
  when you don't want it usable anymore.

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
           allow update, delete: if false;
         }
       }
     }
   }
   ```

This rule means: only your own phone (recognized by a private key Firebase
generates the first time you use this feature) can ever start a trip,
update its location, or add photos/comments to it; anyone signed in (which
happens automatically and invisibly, including for viewers) can read a trip
they know the passcode for; nobody can overwrite or delete anything but you.

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
