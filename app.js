(function () {
'use strict';

// Bump this string with every update shipped. Shown in Settings and at the
// bottom of the planning screen — mainly so a quick glance (in an incognito
// tab, say) can confirm a phone is actually running the latest upload
// rather than a cached older copy.
// IMPORTANT: on every release, this must be bumped together with
// version.json's "version" AND the ?v= query strings on index.html's
// <script src="app.js?v=..."> and <link href="style.css?v=...">. Those
// query strings are what actually force a fresh fetch instead of the
// browser (or GitHub Pages' CDN) serving a stale cached copy under the
// unchanged, un-busted URL — the update-check banner reloading the page
// alone does NOT guarantee that; see the comment above the stylesheet
// link in index.html for the full story (this was a real bug, not just a
// caution: it's why "accept update" could keep doing nothing).
const APP_VERSION = 'v2026.09.21.1';

/* ============================== UTILITIES ============================== */

const MI_PER_METER = 0.000621371;
const MPS_TO_MPH = 2.23694;
const M_TO_FT = 3.28084;

function haversineMiles(lat1, lon1, lat2, lon2) {
  const R = 3958.8; // miles
  const toRad = (d) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(lat1, lon1, lat2, lon2) {
  const toRad = (d) => d * Math.PI / 180;
  const toDeg = (r) => r * 180 / Math.PI;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function compass(deg) {
  const dirs = ['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function angleDiff(a, b) {
  let d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function fmtMiles(mi) {
  if (mi == null || isNaN(mi)) return '–';
  if (mi < 0.1) return Math.round(mi * 5280) + ' ft';
  return mi.toFixed(mi < 10 ? 1 : 0) + ' mi';
}

// A simple "how far along the drive are we" bar, shared by the driver
// dashboard (#tripProgressFill/#tripProgressPct) and the watch screen
// (#watchProgressFill/#watchProgressPct) — same markup, same math, just
// fed from each side's own idea of "how far traveled" and "how far total"
// (see the two call sites: onLocationUpdate() for the driver,
// renderWatchTrip() for a viewer using the shared route's cumDist data).
function renderTripProgressBar(fillId, pctId, traveledMiles, totalMiles) {
  const fillEl = document.getElementById(fillId);
  const pctEl = document.getElementById(pctId);
  if (!fillEl || !pctEl) return;
  if (!totalMiles || totalMiles <= 0 || traveledMiles == null) {
    fillEl.style.width = '0%';
    pctEl.textContent = '–';
    return;
  }
  const pct = Math.max(0, Math.min(100, (traveledMiles / totalMiles) * 100));
  fillEl.style.width = pct.toFixed(1) + '%';
  pctEl.textContent = `${Math.round(pct)}% · ${fmtMiles(traveledMiles)} of ${fmtMiles(totalMiles)}`;
}

function fmtDurationShort(sec) {
  if (sec == null || isNaN(sec)) return '–';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return h + 'h ' + m + 'm';
  return m + ' min';
}

function fmtClockFromNowPlus(sec) {
  if (sec == null || isNaN(sec)) return '–';
  const d = new Date(Date.now() + sec * 1000);
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// Label shown under the ETA time whenever arrival falls on a different
// calendar day than right now — on a multi-day leg (hundreds/thousands of
// miles), "9:30 AM" alone reads as "this morning" even when it's actually
// a day or more out. Returns '' for a same-day ETA, since the plain time
// is unambiguous there.
function etaDateLabel(sec) {
  if (sec == null || isNaN(sec)) return '';
  const now = new Date();
  const eta = new Date(Date.now() + sec * 1000);
  const sameDay = eta.getFullYear() === now.getFullYear() && eta.getMonth() === now.getMonth() && eta.getDate() === now.getDate();
  if (sameDay) return '';
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const isTomorrow = eta.getFullYear() === tomorrow.getFullYear() && eta.getMonth() === tomorrow.getMonth() && eta.getDate() === tomorrow.getDate();
  if (isTomorrow) return 'Tomorrow';
  return eta.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function toast(msg, ms) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), ms || 6000);
}

/* ============================== STATE / STORAGE ============================== */

const LS_SETTINGS = 'rtnav_settings_v1';
const LS_TRIP = 'rtnav_trip_v1';

// Safety net for an in-progress leg surviving a full app/browser kill —
// very possible after being backgrounded for hours (overnight at a hotel,
// phone restarted, browser reclaiming memory). Saved automatically
// whenever the route or sharing status changes, with no separate "save"
// step for the driver to remember, and offered back as a "Resume Trip"
// prompt (see checkForActiveLeg()) the next time the app opens — so an
// interrupted trip, and its share link if one was active, can pick up
// right where it left off instead of starting over with a new link.
const LS_ACTIVE_LEG = 'rtnav_active_leg_v1';

function persistActiveLeg() {
  if (!state.route) { clearActiveLeg(); return; }
  try {
    localStorage.setItem(LS_ACTIVE_LEG, JSON.stringify({
      route: state.route,
      destLabel: (state.route.destForReroute && state.route.destForReroute.label) || null,
      legLabel: state.currentLegLabel || null,
      pin: (state.share.active && state.share.pin) || null,
      itinerary: state.itinerary || null,
      savedAt: Date.now(),
    }));
  } catch (e) { /* localStorage full/unavailable — resume just won't be offered */ }
}
function loadActiveLeg() {
  try { return JSON.parse(localStorage.getItem(LS_ACTIVE_LEG) || 'null'); }
  catch (e) { return null; }
}
function clearActiveLeg() {
  localStorage.removeItem(LS_ACTIVE_LEG);
}

// How long a shared photo's image data lives in Firestore before the app's
// own cleanup routine (see cleanupExpiredMedia() below) deletes it. Only
// photo events get this field — comments and video links (which just hold
// a small Google Drive URL, not the video itself) are lightweight and never
// expire. This never touches the separate, on-device "Saved legs" list used
// for "Use as destination" — that data lives only in this browser's local
// storage, not Firestore.
const MEDIA_TTL_DAYS = 90;

// This phone's own list of trips it has ever started sharing — just enough
// (pin + when) to let cleanupExpiredMedia() know which trips to check back
// on later for expired photos. Small and self-capped; not sensitive data.
const LS_OWN_TRIPS = 'rtnav_own_trips_v1';
const LS_LAST_MEDIA_CLEANUP = 'rtnav_last_media_cleanup_v1';
const MEDIA_CLEANUP_MIN_INTERVAL_MS = 20 * 60 * 60 * 1000; // run at most ~once/day

// De-dupes by pin (keeping the earliest startedAt for each) — belt and
// suspenders alongside the pin-already-known check in rememberOwnTrip()
// below, so a duplicate that already made it into localStorage (e.g. from
// before that fix) quietly cleans itself up the next time this loads,
// rather than needing anyone to notice and clear it by hand. If only one
// of the duplicate copies has a label (from a rename), that label is kept
// rather than silently dropped.
function loadOwnTrips() {
  let list;
  try { list = JSON.parse(localStorage.getItem(LS_OWN_TRIPS) || '[]'); }
  catch (e) { return []; }
  const seen = new Map();
  for (const t of list) {
    if (!t || !t.pin) continue;
    const existing = seen.get(t.pin);
    if (!existing) { seen.set(t.pin, t); continue; }
    const keep = t.startedAt < existing.startedAt ? t : existing;
    const label = existing.label || t.label;
    seen.set(t.pin, label ? { ...keep, label } : keep);
  }
  const deduped = Array.from(seen.values()).sort((a, b) => a.startedAt - b.startedAt);
  if (deduped.length !== list.length) {
    localStorage.setItem(LS_OWN_TRIPS, JSON.stringify(deduped));
  }
  return deduped;
}
function rememberOwnTrip(pin, label) {
  const list = loadOwnTrips();
  if (list.some((t) => t.pin === pin)) return; // reconnecting to an existing trip, not a new one
  const entry = { pin, startedAt: Date.now() };
  if (label) entry.label = label;
  list.push(entry);
  while (list.length > 100) list.shift(); // cap growth; this is a lot of trips
  localStorage.setItem(LS_OWN_TRIPS, JSON.stringify(list));
}
// Lets "My past trip logs" be renamed after the fact — e.g. when no label
// was given at Calculate Route time. Passing an empty/blank label clears it
// back to the plain date display.
function renameOwnTrip(pin, label) {
  const list = loadOwnTrips();
  const t = list.find((x) => x.pin === pin);
  if (!t) return;
  if (label) t.label = label; else delete t.label;
  localStorage.setItem(LS_OWN_TRIPS, JSON.stringify(list));
}
// Removes one entry from "My past trip logs" on this device only. The
// actual trip log in Firestore (photos, comments, route) is untouched and
// can always be found again by passcode via the "Add" recovery box.
function forgetOwnTrip(pin) {
  const list = loadOwnTrips().filter((t) => t.pin !== pin);
  localStorage.setItem(LS_OWN_TRIPS, JSON.stringify(list));
}

function loadSettings() {
  const defaults = {
    orsKey: '', rangeMiles: null, breakMinutes: 120, voiceEnabled: false,
    locationSource: 'device', // 'device' (this device's own GPS, default) | 'relay' (phone via local relay, for PCs without GPS)
    relayUrl: '',
    // Route preference — see calcRouteWithPreference():
    //  'fastest'        — plain fastest route, highways/interstates used as needed (old default behavior)
    //  'balanced'       — back roads if the all-back-roads route isn't much slower (within backRoadsToleranceMinutes)
    //  'avoid-highways' — always avoid highways/interstates, no matter the time cost
    routePreference: 'fastest',
    backRoadsToleranceMinutes: 15, // only used by 'balanced'
    // When you drift off the calculated route — see maybeReroute():
    //  'ask'  — show an on-screen (and once, spoken) offer and let you decide (default)
    //  'auto' — recalculate right away, no prompt (the old, only behavior)
    rerouteMode: 'ask',
  };
  try { return Object.assign(defaults, JSON.parse(localStorage.getItem(LS_SETTINGS) || '{}')); }
  catch (e) { return defaults; }
}
function saveSettings(s) { localStorage.setItem(LS_SETTINGS, JSON.stringify(s)); }

function loadTrip() {
  try { return Object.assign({ legs: [] }, JSON.parse(localStorage.getItem(LS_TRIP) || '{}')); }
  catch (e) { return { legs: [] }; }
}
function saveTrip(t) { localStorage.setItem(LS_TRIP, JSON.stringify(t)); }

const state = {
  settings: loadSettings(),
  trip: loadTrip(),
  loc: null,             // latest {lat,lon,accuracy,heading,speed,updatedAt} from this device's own GPS
  geoWatchId: null,
  manualStart: null,    // {lat,lon,label} if user set a manual start
  // True from the moment "Set manually" is tapped until a result is
  // actually picked (or coordinates/a Google Maps link is recognized) —
  // see updateSetupStartLabel(). Needed because manualStart itself is
  // still null during that in-between window (nothing's been chosen yet),
  // so without this flag, a live GPS fix arriving while you're mid-typing
  // your address would overwrite the field's text mid-keystroke.
  manualStartEditing: false,
  pendingDest: null,    // {lat,lon,label} chosen from search results before route calc
  // Multi-day trip plan being BUILT on the setup screen, before it's
  // calculated — see addStopToPlan()/renderTripPlanUI(). Each entry:
  // {fromLabel, destLabel, destLat, destLon, label}. null/empty means "no
  // plan being built right now," the ordinary single-leg flow.
  pendingItinerary: [],
  // The ACTIVE, already-calculated multi-day trip plan, once
  // calculateTripPlan() has run — see that function's comment for the
  // shape, and advanceToNextLeg()/wireEndLeg() for how driving through it
  // day by day works. null outside of a multi-day trip (the common case);
  // state.route/state.currentLegLabel always describe whichever single day
  // is currently being driven, exactly as they do without an itinerary at
  // all, so none of the live-driving code (turn-by-turn, progress, reroute,
  // etc.) needs to know or care whether a multi-day plan exists.
  itinerary: null,
  route: null,          // {coords:[[lon,lat]], cumDist:[mi], cumDur:[s], steps:[], totalDist, totalDur}
  currentLegLabel: null, // whatever was typed in "Label this leg" when the route was calculated — see persistActiveLeg()
  currentStepIndex: 0,
  lastRerouteAt: 0,
  // Off-route reroute prompt (see maybeReroute()/offerReroute()) — only used
  // when Settings → "When off-route" is "Ask me first" (the default):
  // 'none' | 'prompt' (big banner showing) | 'declined' (small chip only,
  // after tapping "Keep Going This Way" — stays available without nagging).
  rerouteOfferState: 'none',
  rerouteOffer: null, // {lat,lon} to reroute from, kept fresh while off-route
  driving: { continuousSince: null, stoppedSince: null, lastRestSuggestedAt: null },
  cache: {
    weatherFetchedAtMiles: null, weatherFetchedAt: 0,
    poiFetchedAtMiles: null, poiFetchedAt: 0,
    peaksFetchedAtMiles: null, peaksFetchedAt: 0,
    currentTempF: null, currentTempUnit: null, // last known "Now (your location)" reading — see refreshWeatherAndAlerts()
  },
  map: null, routeLine: null, currentMarker: null, destMarker: null, poiMarkers: [], peakMarkers: [],
  eventMarkers: [],
  etaTapMarker: null, // marker for the driver-side tap-anywhere-for-ETA popup — see handleMapTapForEta()
  // Tracks which US state the driver is currently confirmed to be in, for
  // the automatic "crossed into a new state" comment — see
  // checkUSStateCrossing() below. Persists for the whole page session
  // (not reset per-leg): the state you're physically in doesn't change
  // just because you started a new leg.
  usStateTrack: { confirmed: null, candidate: null, candidateMiles: 0, lastLoc: null },
  // Same idea, for the automatic "just entered a city" comment — see
  // checkUSCityCrossing() below. `confirmed` here is meaningfully
  // different from usStateTrack's: null is a normal, common, ongoing
  // state ("not currently inside any tracked city's circle"), not just
  // "we don't know yet" — hence the separate `initialized` flag to mark
  // the one-time startup fix.
  usCityTrack: { initialized: false, confirmed: null, candidate: null, candidateMiles: 0, lastLoc: null },
  // Same idea again, for the automatic "you crossed into a new time zone"
  // alert — see checkUSTimezoneCrossing() below. `confirmed` holds the
  // whole zone object (not just a name) once known, since the alert needs
  // to look up both the old and new zone's real current UTC offset at the
  // moment of crossing.
  tzTrack: { confirmed: null, candidate: null, candidateMiles: 0, lastLoc: null },
  fb: null, // {app, auth, db, uid} once Firebase is configured and signed in
  share: { active: false, pin: null, ownerUid: null, unsubEvents: null, unsubViewers: null, unsubMessages: null, viewerCount: 0, events: [], messages: [], messagesLoaded: false, lastPushAt: 0, lastPushLoc: null, paused: false, pausedAt: 0, pausedLoc: null, routeDirty: false, lastReplySent: null }, // lastReplySent: {toName,text,sentAt} — see sendDriverReply()/renderViewerMessages()
  watch: { pin: null, trip: null, events: [], unsubTrip: null, unsubEvents: null, presenceInterval: null, presenceUid: null, map: null, routeLine: null, liveMarker: null, eventMarkers: {}, weatherFetchedAt: 0, weatherLoc: null, peaksFetchedAt: 0, peaksLoc: null, fullscreen: false, etaTapMarker: null, unsubReplies: null, replies: [], repliesLoaded: false, itineraryLine: null, overnightMarkers: [], itineraryDrawn: false },
};

/* ============================== ROUTE-SAMPLE MARKERS CLEANUP ============================== */
function clearMarkers(arr, map) {
  const target = map || state.map;
  arr.forEach((m) => target.removeLayer(m));
  arr.length = 0;
}

/* ============================== ORS API ============================== */

function mapGeocodeFeature(f) {
  return {
    label: f.properties.label,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    layer: f.properties.layer || null, // 'address' | 'street' | 'locality' | 'region' | 'venue' | ...
    confidence: f.properties.confidence || null,
  };
}

// Recognizes raw "latitude, longitude" typed straight into a search box
// (e.g. "34.5625, -112.2867", "34.5625 -112.2867", or with N/S/E/W suffixes
// like "34.5625 N, 112.2867 W") so a destination or starting point can be
// pinned exactly, without needing a matching street address — handy for a
// trailhead, campsite, or any spot the address-search geocoder doesn't
// know about. Returns null for anything that isn't a clean coordinate
// pair, so normal address text still falls through to the regular search.
function parseLatLon(text) {
  if (!text) return null;
  const m = text.trim().match(/^(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([NnSs])?\s*[,\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EeWw])?$/);
  if (!m) return null;
  let lat = parseFloat(m[1]);
  let lon = parseFloat(m[3]);
  if (m[2] && /s/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /w/i.test(m[4])) lon = -Math.abs(lon);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

// Recognizes a Google Maps link pasted into a destination/start search box
// and pulls the coordinates straight out of it — a way around the two gaps
// in ORS's own geocoder (see orsGeocode()), which is built entirely on
// OpenStreetMap data: small local businesses that OSM doesn't have mapped
// by name (a beer garden, say), and street intersections (its address
// parser handles house-number addresses and place names, not "Main St &
// Gurley St" style queries). Google Maps covers both far better, so the
// idea is: search or drop a pin there, copy the link, paste it here.
//
// Only a full-length link works (google.com/maps/... or maps.google.com/...)
// — a short share-sheet link like maps.app.goo.gl/xxxx or goo.gl/maps/xxxx
// can't be expanded to find out where it actually points from inside a
// browser page (that redirect doesn't allow a cross-site script to read
// where it leads), so those are recognized just enough to explain why
// rather than silently failing outright. Opening a short link once in any
// browser tab turns it into a full link this can use.
function parseGoogleMapsUrl(text) {
  if (!text) return null;
  const trimmed = text.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (!/google\.[a-z.]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(trimmed)) return null;
  if (/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(trimmed)) return { shortLink: true };

  // Most precise: the place's actual pinned point, e.g. ...!3d34.5395!4d-112.4685...
  let m = trimmed.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
  // Next best: where the map was centered when the link was made, e.g. .../@34.5395,-112.4685,17z
  if (!m) m = trimmed.match(/@(-?\d+\.\d+),(-?\d+\.\d+)(?:,|\/|$)/);
  // Older-style link: ...?q=34.5395,-112.4685
  if (!m) m = trimmed.match(/[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/);
  if (!m) return null;

  const lat = parseFloat(m[1]);
  const lon = parseFloat(m[2]);
  if (!isFinite(lat) || !isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  let label = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  const nameMatch = trimmed.match(/\/place\/([^/@]+)/);
  if (nameMatch) {
    try { label = decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')); } catch (e) { /* keep coordinate label */ }
  }
  return { lat, lon, label };
}

// Words that don't help tell one street from another — directionals and
// the common street-type suffixes — so they're ignored when checking
// whether a geocoded result's label actually mentions the street someone
// typed. Skipping these also sidesteps false negatives from OSM
// abbreviating them inconsistently ("North" vs "N", "Trail" vs "Trl").
const STREET_MATCH_IGNORE_WORDS = new Set([
  'n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw', 'north', 'south', 'east', 'west',
  'st', 'street', 'ave', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane',
  'trail', 'trl', 'way', 'wy', 'blvd', 'boulevard', 'ct', 'court', 'pl', 'place',
  'cir', 'circle', 'pkwy', 'parkway', 'hwy', 'highway', 'loop', 'pass', 'path', 'run',
]);

function streetHasDistinctiveMatch(streetText, resultLabel) {
  if (!streetText || !resultLabel) return true; // nothing to check against — don't block on it
  const words = streetText.toLowerCase().replace(/[.,]/g, '').split(/\s+/)
    .filter((w) => w && !STREET_MATCH_IGNORE_WORDS.has(w) && !/^\d+$/.test(w));
  if (!words.length) return true; // e.g. "N Main St" — no distinctive word left to check
  const label = resultLabel.toLowerCase();
  return words.some((w) => label.includes(w));
}

async function orsGeocode(text) {
  const key = state.settings.orsKey;
  if (!key) throw new Error('No ORS API key set. Open Settings to add one.');
  const focus = getStartCoords();
  let url = `https://api.openrouteservice.org/geocode/search?api_key=${encodeURIComponent(key)}&text=${encodeURIComponent(text)}&size=8&boundary.country=US`;
  if (focus) url += `&focus.point.lon=${focus.lon}&focus.point.lat=${focus.lat}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Geocoding failed (' + res.status + ')');
  const json = await res.json();
  let results = (json.features || []).map(mapGeocodeFeature);

  // If the query looks like it includes a street number but nothing at
  // address-level precision came back for the ACTUAL street typed, the
  // free-text parser may have failed to split the address correctly.
  // Retry with a structured query, which parses each part
  // (address/locality/region) separately and often finds an exact match
  // the plain search missed.
  //
  // "came back for the actual street typed" matters: a plain 'address'-
  // layer hit isn't necessarily the right one. When OSM/Pelias doesn't
  // have your exact house number on your exact street, it can still
  // return some other nearby address at full 'address' precision — same
  // house number, wrong street entirely — badged "Exact" with nothing to
  // suggest it's not actually a match. streetHasDistinctiveMatch() below
  // checks the result's label actually mentions the street name (ignoring
  // directionals like "North"/"N" and suffixes like "Trail"/"Trl", which
  // OSM abbreviates inconsistently) before trusting an 'address' hit.
  const hasHouseNumber = /^\s*\d+\s+\S/.test(text);
  const houseNumMatch = text.match(/^\s*\d+\s+([^,]+)/);
  const streetText = houseNumMatch ? houseNumMatch[1] : '';
  const isTrustworthyAddressHit = (r) => r.layer === 'address' && streetHasDistinctiveMatch(streetText, r.label);
  const hasAddressHit = results.some(isTrustworthyAddressHit);
  if (hasHouseNumber && !hasAddressHit) {
    try {
      const structured = await orsGeocodeStructured(text, focus);
      if (structured.length) {
        // Add any new structured hits, deduped by label.
        const seen = new Set(results.map((r) => r.label));
        structured.forEach((r) => { if (!seen.has(r.label)) { results.push(r); seen.add(r.label); } });
      }
    } catch (e) { /* structured search is a best-effort extra try; ignore failures */ }
  }
  if (hasHouseNumber) {
    // A trustworthy address match floats to the top; other layers
    // (street/city/etc) come next; an 'address'-layer hit that DIDN'T
    // match the street you typed is demoted to last — it's the case
    // above (a wrong-street "Exact" badge), so it shouldn't outrank even
    // an honest lower-precision result.
    const score = (r) => (isTrustworthyAddressHit(r) ? 2 : r.layer === 'address' ? 0 : 1);
    results.sort((a, b) => score(b) - score(a));
  }
  return results;
}

// Naive split of "123 Main St, Flagstaff, AZ 86001" into address/locality/region/postalcode
// for Pelias' structured search endpoint, which parses each field independently instead
// of relying on free-text parsing (which sometimes drops the house number).
async function orsGeocodeStructured(text, focus) {
  const key = state.settings.orsKey;
  const parts = text.split(',').map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return [];
  const address = parts[0];
  const locality = parts[1] || '';
  let region = '', postalcode = '';
  if (parts[2]) {
    const m = parts[2].match(/^([A-Za-z .]+)\s*(\d{5})?$/);
    if (m) { region = m[1].trim(); postalcode = m[2] || ''; } else { region = parts[2]; }
  }
  let url = `https://api.openrouteservice.org/geocode/search/structured?api_key=${encodeURIComponent(key)}&address=${encodeURIComponent(address)}&size=5`;
  if (locality) url += `&locality=${encodeURIComponent(locality)}`;
  if (region) url += `&region=${encodeURIComponent(region)}`;
  if (postalcode) url += `&postalcode=${encodeURIComponent(postalcode)}`;
  url += `&boundary.country=US`;
  if (focus) url += `&focus.point.lon=${focus.lon}&focus.point.lat=${focus.lat}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const json = await res.json();
  return (json.features || []).map(mapGeocodeFeature);
}

// Turns OpenRouteService's raw HTTP-error JSON into something a driver can
// actually act on. Error code 2010 ("Could not find routable point within a
// radius of 350.0 meters of specified coordinate N…") specifically means
// that pin sits too far from anything ORS considers a drivable road — most
// often a pin dropped on private property, an unmapped driveway/forest
// road, or open land with no through-road nearby. This isn't a bug so much
// as a data-coverage gap (the milder version of the same limitation is the
// 🏠 "route ends short of your exact pin" banner elsewhere in the app) —
// but the raw JSON error is meaningless to read on its own, so this at
// least says which point it was (start or destination — orsRoute() always
// sends them in that order, coordinate 0 then 1) and what to try instead.
function friendlyRouteError(e, start, dest) {
  const msg = (e && e.message) || '';
  const m = /coordinate (\d+)/.exec(msg);
  if (m && /Could not find routable point/i.test(msg)) {
    const isStart = m[1] === '0';
    const point = isStart ? start : dest;
    const label = point && point.label ? point.label : (isStart ? 'your starting point' : 'that destination');
    return `Couldn't find a drivable road near ${isStart ? 'your starting point' : label} — it's likely on private property, an unmapped road, or open land with no through-road nearby. Try dragging the pin onto the nearest real road on the fine-tune map, or search for a slightly different address.`;
  }
  return msg;
}

async function orsRoute(start, end, opts) {
  opts = opts || {};
  const key = state.settings.orsKey;
  if (!key) throw new Error('No ORS API key set. Open Settings to add one.');
  const body = {
    coordinates: [[start.lon, start.lat], [end.lon, end.lat]],
    units: 'mi',
    instructions: true,
    language: 'en',
    elevation: true, // adds a 3rd [lon,lat,ele(m)] value per point — used for the live Elevation stat
  };
  // avoidHighways steers ORS off limited-access highways/motorways entirely
  // — see calcRouteWithPreference() for how this feeds the route-preference
  // setting (always-back-roads, or back-roads-if-not-much-slower).
  if (opts.avoidHighways) body.options = { avoid_features: ['highways'] };
  const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { 'Authorization': key, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Routing failed (' + res.status + '): ' + t.slice(0, 200));
  }
  const geojson = await res.json();
  const feature = geojson.features[0];
  const coords = feature.geometry.coordinates; // [lon,lat] or [lon,lat,ele(m)]
  const steps = feature.properties.segments[0].steps;

  // Build cumulative distance (mi) per coordinate index using haversine.
  const cumDist = [0];
  for (let i = 1; i < coords.length; i++) {
    const d = haversineMiles(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
    cumDist.push(cumDist[i - 1] + d);
  }
  const totalDist = feature.properties.summary.distance;
  const totalDur = feature.properties.summary.duration;

  // Build cumulative duration (s) per coordinate index: within each step's
  // waypoint range, distribute that step's duration proportionally to distance.
  let stepPtr = 0;
  let priorDur = 0;
  const cumDur = new Array(coords.length).fill(0);
  for (let i = 0; i < coords.length; i++) {
    while (stepPtr < steps.length - 1 && i > steps[stepPtr].way_points[1]) {
      priorDur += steps[stepPtr].duration;
      stepPtr++;
    }
    const step = steps[stepPtr];
    const [s, e] = step.way_points;
    const distSpan = cumDist[e] - cumDist[s];
    const frac = distSpan > 0 ? (cumDist[i] - cumDist[s]) / distSpan : 0;
    cumDur[i] = priorDur + frac * step.duration;
  }

  return { coords, cumDist, cumDur, steps, totalDist, totalDur };
}

// Calculates a route according to the user's route-preference setting (see
// Settings → Route preference) rather than always taking ORS's plain
// fastest route. Used everywhere a route gets calculated: the main
// Calculate Route button, automatic off-route rerouting, and
// tap-anywhere-for-ETA — so however you've told it to route, it routes
// that way everywhere, consistently.
//
//  'fastest'        — one call, ORS's normal fastest route. Unchanged
//                      behavior from before this setting existed.
//  'avoid-highways' — one call with avoid_features:['highways'], so the
//                      route never uses limited-access highways/interstates
//                      at all, regardless of time cost. If ORS can't find
//                      any route avoiding highways (rare — e.g. the only
//                      road for some stretch is an interstate), falls back
//                      to the plain fastest route rather than failing.
//  'balanced'       — calculates BOTH the fastest route and the
//                      all-back-roads route, then uses the back-roads one
//                      only if it isn't too much slower (within
//                      backRoadsToleranceMinutes of the fastest route) —
//                      this is the "back roads if quicker, or if close in
//                      time" behavior. Tags the result so the caller can
//                      tell the user which way it went and by how much;
//                      see describeRouteChoice().
async function calcRouteWithPreference(start, dest) {
  const pref = state.settings.routePreference || 'fastest';

  if (pref === 'avoid-highways') {
    try {
      const route = await orsRoute(start, dest, { avoidHighways: true });
      route.routeChoice = 'avoid-highways';
      return route;
    } catch (e) {
      toast("Couldn't find a back-roads-only route there — using the regular route instead.", 6000);
      const route = await orsRoute(start, dest);
      route.routeChoice = 'avoid-highways-unavailable';
      return route;
    }
  }

  if (pref === 'balanced') {
    const fastest = await orsRoute(start, dest);
    let backRoads = null;
    try {
      backRoads = await orsRoute(start, dest, { avoidHighways: true });
    } catch (e) {
      // No all-back-roads path available for this trip — just go with
      // fastest, nothing to compare against.
    }
    if (backRoads) {
      const deltaSec = backRoads.totalDur - fastest.totalDur;
      const toleranceSec = (state.settings.backRoadsToleranceMinutes || 0) * 60;
      if (deltaSec <= toleranceSec) {
        backRoads.routeChoice = 'balanced-backroads';
        backRoads.backRoadsDeltaSec = deltaSec;
        return backRoads;
      }
      fastest.routeChoice = 'balanced-fastest';
      fastest.backRoadsDeltaSec = deltaSec;
      return fastest;
    }
    fastest.routeChoice = 'balanced-fastest-only';
    return fastest;
  }

  const route = await orsRoute(start, dest);
  route.routeChoice = 'fastest';
  return route;
}

// Turns calcRouteWithPreference()'s tagging into a one-line toast so the
// driver can see *why* they got the route they did — only for the
// 'balanced' outcomes, since 'fastest' and 'avoid-highways' are
// deterministic from the setting and don't need explaining every time.
function describeRouteChoice(route) {
  if (route.routeChoice === 'balanced-backroads') {
    const extra = Math.round((route.backRoadsDeltaSec || 0) / 60);
    return extra > 0
      ? `Took back roads instead of the interstate — about ${extra} min longer.`
      : 'Took back roads instead of the interstate.';
  }
  if (route.routeChoice === 'balanced-fastest') {
    const extra = Math.round((route.backRoadsDeltaSec || 0) / 60);
    return `Used the fastest route — an all-back-roads route would add about ${extra} min.`;
  }
  return null;
}

// Turns a tapped lat/lon into a human place name (e.g. "Kingman, AZ") for
// the tap-for-ETA popup — see handleMapTapForEta(). Best-effort: a failure
// here (or no match) just means the popup shows without a name, never
// blocks showing the ETA itself.
async function orsReverseGeocode(lat, lon) {
  const key = state.settings.orsKey;
  if (!key) return null;
  try {
    const url = `https://api.openrouteservice.org/geocode/reverse?api_key=${encodeURIComponent(key)}&point.lat=${lat}&point.lon=${lon}&size=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    const f = json.features && json.features[0];
    return f ? f.properties.label : null;
  } catch (e) { return null; }
}

// Tap-anywhere-for-ETA: calculates a fresh, one-off route from wherever you
// are right now to wherever you tapped on the map — on your planned route,
// a detour off it, whatever — and shows the drive time and a clock-time
// ETA. This is a separate, throwaway calculation from orsRoute() each
// time; it never touches or replaces your actual navigation route
// (state.route). See initMap()'s click handler for what triggers this, and
// handleWatchMapTapForEta() for the viewer-side counterpart (which can't
// do live routing since viewers have no ORS key of their own, so it
// estimates instead using the route data already shared with them).
async function handleMapTapForEta(lat, lon) {
  if (!state.settings.orsKey) { toast('Add your OpenRouteService API key in Settings to use tap-for-ETA.', 5000); return; }
  if (!state.loc) { toast('Waiting for your own GPS position first.', 4000); return; }
  if (!state.map) return;
  if (state.etaTapMarker) { state.map.removeLayer(state.etaTapMarker); state.etaTapMarker = null; }
  const marker = L.marker([lat, lon]).addTo(state.map)
    .bindPopup('<div style="min-width:160px;">Calculating…</div>')
    .openPopup();
  state.etaTapMarker = marker;
  try {
    const [route, label, weather] = await Promise.all([
      calcRouteWithPreference(state.loc, { lat, lon }),
      orsReverseGeocode(lat, lon),
      nwsCurrentConditionsAt(lat, lon),
    ]);
    const etaTime = fmtClockFromNowPlus(route.totalDur);
    const etaDate = etaDateLabel(route.totalDur);
    const lastCoord = route.coords[route.coords.length - 1];
    const elevFt = (lastCoord && typeof lastCoord[2] === 'number') ? Math.round(lastCoord[2] * M_TO_FT) : null;
    marker.setPopupContent(`
      <div style="min-width:180px;">
        <b>📍 ${escapeHtml(label || 'This spot')}</b><br>
        ${fmtMiles(route.totalDist)} · ${fmtDurationShort(route.totalDur)} drive<br>
        <b>ETA ${etaTime}${etaDate ? ' · ' + etaDate : ''}</b>
        ${tapEtaExtrasLine(elevFt, weather)}
      </div>`);
  } catch (e) {
    marker.setPopupContent(`<div style="min-width:160px;">Couldn't find a route there: ${escapeHtml(e.message)}</div>`);
  }
}

/* ============================== LOCATION (this device's own GPS) ============================== */

function getStartCoords() {
  if (state.manualStart) return state.manualStart;
  if (state.loc) return { lat: state.loc.lat, lon: state.loc.lon };
  return null;
}

let lastGeoUpdateAt = 0;
let geoStaleCheckTimer = null;
let relayPollTimer = null;

// Dispatches to the configured location source. Phone-own-GPS is the
// default and primary path for everyone; the relay option exists only for
// the case of running this on a device with no real GPS (e.g. a Windows
// PC), fed by a phone running the small companion relay server.
function startLocationSource() {
  stopLocationSource();
  if (state.settings.locationSource === 'relay' && state.settings.relayUrl) {
    startRelayPolling();
  } else {
    startGeolocationDevice();
  }
}

function stopLocationSource() {
  if (state.geoWatchId != null && 'geolocation' in navigator) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  clearInterval(geoStaleCheckTimer);
  clearInterval(relayPollTimer);
  geoStaleCheckTimer = null;
  relayPollTimer = null;
  lastGeoUpdateAt = 0;
}

function startGeolocationDevice() {
  const connEl = document.getElementById('connStatus');
  if (!('geolocation' in navigator)) {
    connEl.className = 'conn-status conn-bad';
    connEl.textContent = 'GPS: not supported by this browser';
    return;
  }
  connEl.className = 'conn-status conn-unknown';
  connEl.textContent = 'GPS: getting a fix…';

  state.geoWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      state.loc = {
        lat: c.latitude,
        lon: c.longitude,
        accuracy: c.accuracy,
        heading: (typeof c.heading === 'number' && !isNaN(c.heading)) ? c.heading : null,
        speed: (typeof c.speed === 'number' && !isNaN(c.speed)) ? c.speed : null,
        updatedAt: Date.now(),
      };
      lastGeoUpdateAt = Date.now();
      connEl.className = 'conn-status conn-ok';
      connEl.textContent = 'GPS: connected (±' + Math.round((c.accuracy || 0) * 3.28084) + ' ft)';
      updateSetupStartLabel();
      onLocationUpdate();
    },
    (err) => {
      connEl.className = 'conn-status conn-bad';
      connEl.textContent = 'GPS error: ' + (err.message || 'unavailable') +
        (err.code === 1 ? ' — allow location access for this site' : '');
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 }
  );

  // Watchdog: if updates stop arriving (browser suspended in background, etc.)
  // reflect that in the status badge rather than silently going quiet.
  clearInterval(geoStaleCheckTimer);
  geoStaleCheckTimer = setInterval(() => {
    if (!lastGeoUpdateAt) return;
    const ageSec = (Date.now() - lastGeoUpdateAt) / 1000;
    if (ageSec > 15) {
      connEl.className = 'conn-status conn-bad';
      connEl.textContent = 'GPS: stale (' + Math.round(ageSec) + 's since last fix)';
    }
  }, 5000);
}

// Polls a small relay server (run on a phone-reachable local network) for
// the latest location a phone has posted to it. See the pc-relay/ folder
// for the companion server + phone beacon page this talks to.
function startRelayPolling() {
  const connEl = document.getElementById('connStatus');
  const base = state.settings.relayUrl.replace(/\/+$/, '');
  connEl.className = 'conn-status conn-unknown';
  connEl.textContent = 'GPS: connecting to phone relay…';

  const poll = async () => {
    try {
      const res = await fetch(base + '/api/location', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const json = await res.json();
      if (!json.latest) {
        connEl.className = 'conn-status conn-unknown';
        connEl.textContent = 'GPS: relay reachable, waiting for your phone…';
        return;
      }
      const l = json.latest;
      state.loc = {
        lat: l.lat, lon: l.lon, accuracy: l.accuracy,
        heading: l.heading, speed: l.speed,
        updatedAt: l.receivedAt || Date.now(),
      };
      lastGeoUpdateAt = Date.now();
      connEl.className = 'conn-status conn-ok';
      connEl.textContent = 'GPS: via phone relay (±' + Math.round((l.accuracy || 0) * 3.28084) + ' ft)';
      updateSetupStartLabel();
      onLocationUpdate();
    } catch (e) {
      connEl.className = 'conn-status conn-bad';
      connEl.textContent = 'GPS: can\'t reach relay — check the URL, that both devices are on the same network, and that you\'ve opened the relay URL directly in this browser once';
    }
  };

  poll();
  clearInterval(relayPollTimer);
  relayPollTimer = setInterval(poll, 3000);

  clearInterval(geoStaleCheckTimer);
  geoStaleCheckTimer = setInterval(() => {
    if (!lastGeoUpdateAt) return;
    const ageSec = (Date.now() - lastGeoUpdateAt) / 1000;
    if (ageSec > 15) {
      connEl.className = 'conn-status conn-bad';
      connEl.textContent = 'GPS: stale (' + Math.round(ageSec) + 's since last fix from relay)';
    }
  }, 5000);
}

function updateSetupStartLabel() {
  const startInput = document.getElementById('startInput');
  if (state.manualStart || state.manualStartEditing) return; // manual overrides display already set (or being typed right now)
  if (state.loc) {
    startInput.value = `Live GPS: ${state.loc.lat.toFixed(4)}, ${state.loc.lon.toFixed(4)}`;
  } else {
    startInput.value = '';
    startInput.placeholder = 'Waiting for GPS…';
  }
  refreshCalcButton();
}

function refreshCalcButton() {
  const calcBtn = document.getElementById('calcRouteBtn');
  const addStopBtn = document.getElementById('addStopBtn');
  const calcPlanBtn = document.getElementById('calcTripPlanBtn');
  const hasPlan = state.pendingItinerary && state.pendingItinerary.length > 0;
  // Once a trip plan has at least one stop queued, the plain single-leg
  // Calculate Route button steps aside for "Add as a stop"/"Calculate &
  // Start Trip Plan" below — having both active at once would leave it
  // ambiguous whether a typed destination is "today's whole route" or
  // "the next day in the plan." See renderTripPlanUI().
  calcBtn.disabled = hasPlan || !(getStartCoords() && state.pendingDest && state.settings.orsKey);
  // Stop 1 still needs a real starting point (GPS or manual); stop 2+
  // always starts from wherever the previous stop ends, so the starting
  // point requirement only applies before any stops are queued yet.
  if (addStopBtn) addStopBtn.disabled = !((hasPlan || getStartCoords()) && state.pendingDest && state.settings.orsKey);
  if (calcPlanBtn) calcPlanBtn.disabled = !(hasPlan && state.settings.orsKey);
}

/* ============================== MULTI-DAY TRIP PLAN ============================== */
// Lets you build several days' worth of legs at once (each with its own
// overnight-stop marker) before you start driving, then calculates and
// drives through them one day at a time under ONE shared trip — see
// calculateTripPlan(), advanceToNextLeg(), and wireEndLeg() for how a day
// actually gets driven and handed off to the next. The plan itself is just
// a queue of destinations built with the exact same search/fine-tune-pin
// UI already used for a single-leg destination (see wireSetupScreen()) —
// "Add as a stop" reuses whatever's currently picked in state.pendingDest
// instead of calculating it as today's whole route.

// Redraws the queued-stops list on the setup screen and shows/hides the
// buttons around it. Called after every add/remove and on page load.
function renderTripPlanUI() {
  const list = document.getElementById('tripPlanList');
  const calcPlanBtn = document.getElementById('calcTripPlanBtn');
  const clearBtn = document.getElementById('clearTripPlanBtn');
  const addBtn = document.getElementById('addStopBtn');
  const calcBtn = document.getElementById('calcRouteBtn');
  const hint = document.getElementById('tripPlanHint');
  if (!list) return;
  const stops = state.pendingItinerary || [];
  const has = stops.length > 0;
  list.classList.toggle('hidden', !has);
  calcPlanBtn.classList.toggle('hidden', !has);
  clearBtn.classList.toggle('hidden', !has);
  calcBtn.classList.toggle('hidden', has);
  if (addBtn) addBtn.textContent = has ? '➕ Add another day' : '➕ Add as a stop, plan another day';
  if (hint) hint.classList.toggle('hidden', has);
  list.innerHTML = stops.map((s, i) => `
    <div class="leg-item">
      <span>Day ${i + 1}${s.label ? ': ' + escapeHtml(s.label) : ''} — ${escapeHtml(s.fromLabel)} → ${escapeHtml(s.destLabel)}</span>
      <button type="button" class="ghost-btn small remove-plan-stop-btn" data-i="${i}" title="Remove">🗑</button>
    </div>`).join('');
  list.querySelectorAll('.remove-plan-stop-btn').forEach((btn) => {
    btn.onclick = () => {
      const i = parseInt(btn.dataset.i, 10);
      state.pendingItinerary.splice(i, 1);
      // Re-chain each remaining stop's "from" label — removing one from the
      // middle means the next one's actual starting point just changed.
      state.pendingItinerary.forEach((stop, j) => {
        stop.fromLabel = j === 0
          ? (state.manualStart ? state.manualStart.label : 'your starting point')
          : state.pendingItinerary[j - 1].destLabel;
      });
      renderTripPlanUI();
      refreshCalcButton();
    };
  });
  refreshCalcButton();
}

// "Add as a stop" — takes whatever's currently picked in the Destination
// field (same state.pendingDest a plain Calculate Route would use) and
// appends it to the plan instead, then clears the field so the next stop
// can be entered. The very first stop's "from" is today's actual starting
// point (GPS or manual, same as a single-leg trip); every stop after that
// starts wherever the previous one ends.
function addStopToPlan() {
  const dest = state.pendingDest;
  const errEl = document.getElementById('setupError');
  if (!dest) { errEl.textContent = 'Pick a destination first.'; return; }
  errEl.textContent = '';
  if (!state.pendingItinerary) state.pendingItinerary = [];
  const fromLabel = state.pendingItinerary.length
    ? state.pendingItinerary[state.pendingItinerary.length - 1].destLabel
    : (state.manualStart ? state.manualStart.label : 'your starting point');
  const label = document.getElementById('legLabelInput').value.trim();
  state.pendingItinerary.push({ fromLabel, destLabel: dest.label, destLat: dest.lat, destLon: dest.lon, label: label || null });
  document.getElementById('destInput').value = '';
  document.getElementById('legLabelInput').value = '';
  document.getElementById('destResults').innerHTML = '';
  document.getElementById('destFineTune').classList.add('hidden');
  state.pendingDest = null;
  renderTripPlanUI();
}

function clearTripPlan() {
  if (!(state.pendingItinerary && state.pendingItinerary.length)) return;
  if (!window.confirm('Clear the whole trip plan you\'ve built so far? This only clears what you\'ve queued up — nothing has been calculated or shared yet.')) return;
  state.pendingItinerary = [];
  renderTripPlanUI();
}

// Samples each day's already-calculated route down to a modest number of
// points and concatenates them into one continuous overview line — this is
// what lets a watcher see the WHOLE planned trip (including days not
// driven yet) on their map, separate from the normal live routeCoords
// field, which only ever describes the day actually being driven right
// now (see renderWatchTrip()). Total point count is capped regardless of
// how many days are in the plan, so a two-week itinerary doesn't balloon
// the shared document's size the way sampling each day at a fixed count
// would.
function buildItineraryOverviewCoords(itinerary) {
  const perLeg = Math.max(15, Math.floor(600 / itinerary.legs.length));
  const out = [];
  itinerary.legs.forEach((leg) => {
    sampleRouteForShare(leg.route, perLeg).forEach((p) => out.push({ lat: p.lat, lon: p.lon }));
  });
  return out;
}

// Calculates every queued stop as its own leg (in order, each one's start
// being the previous stop's destination) and starts driving Day 1 —
// otherwise follows the exact same steps as the plain Calculate Route
// button (see wireSetupScreen()'s calcBtn handler), just repeated per day
// and wrapped up into state.itinerary at the end. Reusing
// calcRouteWithPreference() per leg (rather than one combined multi-
// waypoint request) means every existing per-day feature — reroute,
// turn-by-turn, the route-preference setting — keeps working completely
// unchanged, since state.route always describes one ordinary single-leg
// route, exactly as it does outside of a trip plan.
async function calculateTripPlan() {
  const stops = state.pendingItinerary;
  const errEl = document.getElementById('setupError');
  const calcPlanBtn = document.getElementById('calcTripPlanBtn');
  errEl.textContent = '';
  if (!stops || !stops.length) return;
  const firstStart = getStartCoords();
  if (!firstStart) { errEl.textContent = 'Set a starting point first.'; return; }
  calcPlanBtn.disabled = true;
  const origText = calcPlanBtn.textContent;
  // Tracks whichever start/destination pair is currently being calculated,
  // so if calcRouteWithPreference() throws, the catch block below can still
  // say which day/pin it was about — see friendlyRouteError().
  let attemptStart = firstStart, attemptDest = null;
  try {
    const legs = [];
    let legStart = firstStart;
    for (let i = 0; i < stops.length; i++) {
      calcPlanBtn.textContent = `Calculating day ${i + 1} of ${stops.length}…`;
      const dest = { lat: stops[i].destLat, lon: stops[i].destLon, label: stops[i].destLabel };
      attemptStart = legStart; attemptDest = dest;
      const route = await calcRouteWithPreference(legStart, dest);
      route.destForReroute = dest;
      legs.push({ label: stops[i].label, destLabel: stops[i].destLabel, destLat: stops[i].destLat, destLon: stops[i].destLon, route });
      legStart = dest;
    }
    state.itinerary = { legs, currentLegIdx: 0 };
    state.pendingItinerary = [];

    const first = legs[0];
    state.route = first.route;
    state.currentStepIndex = 0;
    nearestIndexCache = 0;
    state.lastRerouteAt = 0;
    state.rerouteOfferState = 'none';
    state.rerouteOffer = null;
    state.announced = new Set();
    state.arrivalAnnounced = false;
    state.currentLegLabel = first.label || null;

    state.trip.legs.push({
      id: 'leg_' + Date.now(),
      label: first.label || null,
      destLabel: first.destLabel,
      destLat: first.destLat, destLon: first.destLon,
      createdAt: Date.now(),
    });
    saveTrip(state.trip);
    persistActiveLeg();

    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
    if (!state.map) initMap();
    state.followMe = true;
    if (state.recenterBtnDiv) state.recenterBtnDiv.classList.add('hidden');
    drawRoute();
    onLocationUpdate();
    renderSharePanel();
    requestNavWakeLock();
    updateEndLegButtonLabel();
    toast(`Trip plan ready — ${legs.length} day${legs.length > 1 ? 's' : ''}. Starting Day 1${first.label ? ': ' + first.label : ''}.`, 7000);
  } catch (e) {
    errEl.textContent = friendlyRouteError(e, attemptStart, attemptDest);
  } finally {
    calcPlanBtn.disabled = false;
    calcPlanBtn.textContent = origText;
    refreshCalcButton();
  }
}

// Relabels the dashboard's end-of-leg button so it's honest about what
// tapping it actually does right now: advance to tomorrow's already-
// planned day (multi-day trip, more days left), end the whole trip (multi-
// day trip, this was the last day), or the plain original wording outside
// of a trip plan altogether. Called wherever state.itinerary changes.
function updateEndLegButtonLabel() {
  const btn = document.getElementById('endLegBtn');
  if (!btn) return;
  const it = state.itinerary;
  if (it && it.currentLegIdx + 1 < it.legs.length) {
    btn.textContent = `🏁 End Day ${it.currentLegIdx + 1} / Continue to Day ${it.currentLegIdx + 2}`;
  } else if (it) {
    btn.textContent = `🏁 End Trip (Day ${it.currentLegIdx + 1} of ${it.legs.length})`;
  } else {
    btn.textContent = '🏁 End This Leg / Plan Next Leg';
  }
}

// Hands driving off from the day that just ended to the next already-
// calculated day in the plan, WITHOUT ending the shared trip — the same
// pin/link keeps working the whole way through, which is the entire point
// of a trip plan versus starting a brand-new share each morning. If
// sharing is active, marks it "taking a break" (the same visual/wording as
// ⏸ Pause for the Night) until you're actually moving again on the new
// day, exactly like an ordinary overnight stop already works.
function advanceToNextLeg() {
  const it = state.itinerary;
  it.currentLegIdx++;
  const leg = it.legs[it.currentLegIdx];
  state.route = leg.route;
  state.currentLegLabel = leg.label || null;
  state.currentStepIndex = 0;
  nearestIndexCache = 0;
  state.lastRerouteAt = 0;
  state.rerouteOfferState = 'none';
  state.rerouteOffer = null;
  state.announced = new Set();
  state.arrivalAnnounced = false;
  state.followMe = true;
  if (state.recenterBtnDiv) state.recenterBtnDiv.classList.add('hidden');
  drawRoute();
  onLocationUpdate();
  persistActiveLeg();
  updateEndLegButtonLabel();

  state.trip.legs.push({
    id: 'leg_' + Date.now(),
    label: leg.label || null,
    destLabel: leg.destLabel,
    destLat: leg.destLat, destLon: leg.destLon,
    createdAt: Date.now(),
  });
  saveTrip(state.trip);

  if (state.share.active && state.fb) {
    const sh = state.share;
    sh.paused = true;
    sh.pausedAt = Date.now();
    sh.pausedLoc = state.loc ? { lat: state.loc.lat, lon: state.loc.lon } : null;
    sh.routeDirty = false; // pushing fresh coords directly below, no need for the throttled path to repeat it
    state.fb.db.collection('trips').doc(sh.pin).set({
      legLabel: state.currentLegLabel,
      destLabel: leg.destLabel,
      routeCoords: sampleRouteForShare(state.route, 300),
      totalMiles: state.route.totalDist,
      routeUpdatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      currentLegIndex: it.currentLegIdx,
      paused: true,
      pausedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }, { merge: true }).catch(() => { /* best effort; next location push retries routeCoords via routeDirty */ });
  }

  renderSharePanel();
  toast(`Day ${it.currentLegIdx + 1} of ${it.legs.length} ready${leg.label ? ': ' + leg.label : ''}. Tap ▶ Resume Sharing (or just start driving) once you're back on the road.`, 8000);
}

/* ============================== NWS WEATHER ============================== */

async function nwsForecastAt(lat, lon) {
  const pRes = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
  if (!pRes.ok) throw new Error('NWS points lookup failed');
  const pJson = await pRes.json();
  const hourlyUrl = pJson.properties.forecastHourly;
  const hRes = await fetch(hourlyUrl);
  if (!hRes.ok) throw new Error('NWS hourly forecast failed');
  const hJson = await hRes.json();
  return hJson.properties.periods; // array, [0] = current hour
}

function pickPeriodNear(periods, targetDate) {
  let best = periods[0], bestDiff = Infinity;
  for (const p of periods) {
    const diff = Math.abs(new Date(p.startTime).getTime() - targetDate.getTime());
    if (diff < bestDiff) { bestDiff = diff; best = p; }
  }
  return best;
}

async function nwsAlertsAt(lat, lon) {
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
  if (!res.ok) throw new Error('NWS alerts failed');
  const json = await res.json();
  return json.features || [];
}

// Current conditions (temperature + short forecast) for a single point —
// used by the tap-anywhere-ETA popups on both driver and viewer sides (see
// handleMapTapForEta() / handleWatchMapTapForEta() and tapEtaExtrasLine()
// below). NWS needs no API key, so unlike elevation this works as a live,
// exact lookup from either side. Returns null on any failure (outside NWS/US
// coverage, network hiccup, etc.) — the caller just omits weather from the
// popup rather than blocking on it.
async function nwsCurrentConditionsAt(lat, lon) {
  try {
    const periods = await nwsForecastAt(lat, lon);
    const p = periods && periods[0];
    if (!p) return null;
    return { tempF: p.temperature, tempUnit: p.temperatureUnit || 'F', forecast: p.shortForecast || '' };
  } catch (e) {
    return null;
  }
}

// Builds the "⛰ 4,320 ft · 68°F Partly Cloudy" line appended to tap-for-ETA
// popups. Either piece can be missing (elevFt null/undefined, weather null)
// — each is just omitted rather than showing a blank or "N/A".
function tapEtaExtrasLine(elevFt, weather) {
  const parts = [];
  if (typeof elevFt === 'number') parts.push(`⛰ ${elevFt.toLocaleString()} ft`);
  if (weather) parts.push(`${weather.tempF}°${weather.tempUnit} ${escapeHtml(weather.forecast)}`.trim());
  return parts.length ? `<br><span class="muted" style="font-size:12px;">${parts.join(' · ')}</span>` : '';
}

function coordAtDistance(targetMiles) {
  const { coords, cumDist, cumDur } = state.route;
  if (targetMiles <= 0) return { lat: coords[0][1], lon: coords[0][0], idx: 0, durAtIdx: cumDur[0] };
  if (targetMiles >= cumDist[cumDist.length - 1]) {
    const last = coords[coords.length - 1];
    const lastIdx = coords.length - 1;
    return { lat: last[1], lon: last[0], idx: lastIdx, durAtIdx: cumDur[lastIdx] };
  }
  // binary search
  let lo = 0, hi = cumDist.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cumDist[mid] < targetMiles) lo = mid + 1; else hi = mid;
  }
  const c = coords[lo];
  return { lat: c[1], lon: c[0], idx: lo, durAtIdx: cumDur[lo] };
}

async function refreshWeatherAndAlerts(traveledMiles, totalMiles) {
  const cache = state.cache;
  const now = Date.now();
  const movedEnough = cache.weatherFetchedAtMiles == null || Math.abs(traveledMiles - cache.weatherFetchedAtMiles) > 5;
  const timeEnough = now - cache.weatherFetchedAt > 10 * 60 * 1000;
  if (!movedEnough && !timeEnough) return;
  cache.weatherFetchedAtMiles = traveledMiles;
  cache.weatherFetchedAt = now;

  const weatherPanel = document.getElementById('weatherPanel');
  const alertsPanel = document.getElementById('alertsPanel');

  const remaining = totalMiles - traveledMiles;
  const sampleOffsets = [0, remaining * 0.33, remaining * 0.66].filter((v, i, a) => i === 0 || v > a[i - 1] + 2);
  const points = sampleOffsets.map((off) => coordAtDistance(traveledMiles + off));

  try {
    const rows = [];
    const alertFeatures = [];
    const curDur = state.route.cumDur[nearestIndexCache] || 0;
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      const etaSecFromNow = Math.max(0, pt.durAtIdx - curDur);
      try {
        const periods = await nwsForecastAt(pt.lat, pt.lon);
        const targetDate = i === 0 ? new Date() : new Date(Date.now() + etaSecFromNow * 1000);
        const period = pickPeriodNear(periods, targetDate);
        rows.push({ label: i === 0 ? 'Now (your location)' : `~${Math.round(sampleOffsets[i])} mi ahead`,
          temp: period.temperature, unit: period.temperatureUnit, forecast: period.shortForecast,
          wind: period.windSpeed, pop: (period.probabilityOfPrecipitation && period.probabilityOfPrecipitation.value) || 0 });
        // Stashed so photos/videos/comments added around this time can be
        // tagged with the temperature at the moment, without a separate
        // lookup — see eventMetaLine() / addPhoto() / addComment().
        if (i === 0) {
          state.cache.currentTempF = period.temperature;
          state.cache.currentTempUnit = period.temperatureUnit;
        }
      } catch (e) { /* skip this point */ }
      try {
        const alerts = await nwsAlertsAt(pt.lat, pt.lon);
        alerts.forEach((a) => alertFeatures.push(a));
      } catch (e) { /* skip */ }
    }

    if (rows.length) {
      weatherPanel.innerHTML = rows.map((r) => `
        <div class="item-row">
          <div>
            <div class="item-main">${r.temp}°${r.unit} — ${r.forecast}</div>
            <div class="item-sub">${r.label} · wind ${r.wind}${r.pop ? ' · ' + r.pop + '% precip' : ''}</div>
          </div>
        </div>`).join('');
    } else {
      weatherPanel.innerHTML = '<span class="muted">Weather unavailable right now.</span>';
    }

    // Dedupe alerts by id
    const seen = new Set();
    const uniqueAlerts = alertFeatures.filter((a) => (seen.has(a.id) ? false : (seen.add(a.id), true)));
    if (uniqueAlerts.length) {
      alertsPanel.innerHTML = uniqueAlerts.slice(0, 6).map((a) => {
        const p = a.properties;
        const sev = (p.severity || '').toLowerCase();
        const cls = sev === 'extreme' || sev === 'severe' ? 'bad' : sev === 'moderate' ? 'warn' : 'good';
        return `<div class="item-row"><div>
          <div class="item-main"><span class="badge ${cls}">${p.severity || 'Alert'}</span> ${p.event}</div>
          <div class="item-sub">${(p.headline || '').slice(0, 140)}</div>
        </div></div>`;
      }).join('');
    } else {
      alertsPanel.innerHTML = '<span class="muted">No active NWS alerts along your route.</span>';
    }
  } catch (e) {
    weatherPanel.innerHTML = `<span class="muted">Weather error: ${e.message}</span>`;
  }
}
let nearestIndexCache = 0;

/* ============================== OVERPASS: POIs + PEAKS ============================== */

async function overpassQuery(ql) {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: 'data=' + encodeURIComponent(ql),
  });
  if (!res.ok) throw new Error('Overpass query failed (' + res.status + ')');
  return res.json();
}

async function refreshPOIs(traveledMiles) {
  const cache = state.cache;
  const now = Date.now();
  const movedEnough = cache.poiFetchedAtMiles == null || Math.abs(traveledMiles - cache.poiFetchedAtMiles) > 5;
  const timeEnough = now - cache.poiFetchedAt > 5 * 60 * 1000;
  if (!movedEnough && !timeEnough) return;
  cache.poiFetchedAtMiles = traveledMiles;
  cache.poiFetchedAt = now;

  const panel = document.getElementById('poiPanel');
  const cur = state.loc;
  if (!cur) return;
  const radiusM = 24000; // ~15 mi
  const ql = `[out:json][timeout:20];
(
  node["amenity"="fuel"](around:${radiusM},${cur.lat},${cur.lon});
  node["amenity"="restaurant"](around:${radiusM},${cur.lat},${cur.lon});
  node["highway"="rest_area"](around:${radiusM},${cur.lat},${cur.lon});
  node["tourism"="viewpoint"](around:${radiusM},${cur.lat},${cur.lon});
  node["tourism"="attraction"](around:${radiusM},${cur.lat},${cur.lon});
);
out center 40;`;
  try {
    const json = await overpassQuery(ql);
    const heading = cur.heading;
    let items = json.elements
      .filter((el) => el.tags && (el.tags.name))
      .map((el) => {
        const dist = haversineMiles(cur.lat, cur.lon, el.lat, el.lon);
        const brg = bearingDeg(cur.lat, cur.lon, el.lat, el.lon);
        return { ...el, dist, brg };
      });
    if (typeof heading === 'number') {
      items = items.filter((el) => angleDiff(el.brg, heading) < 100);
    }
    items.sort((a, b) => a.dist - b.dist);
    items = items.slice(0, 12);

    clearMarkers(state.poiMarkers);
    if (items.length) {
      panel.innerHTML = items.map((el) => {
        const kind = el.tags.amenity === 'fuel' ? '⛽ Gas' :
                     el.tags.amenity === 'restaurant' ? '🍽 Food' :
                     el.tags.highway === 'rest_area' ? '🛑 Rest Area' :
                     el.tags.tourism === 'viewpoint' ? '👁 Viewpoint' : '📌 Attraction';
        return `<div class="item-row"><div>
          <div class="item-main">${kind} — ${el.tags.name}</div>
          <div class="item-sub">${compass(el.brg)} of you</div>
        </div><div class="item-right">${fmtMiles(el.dist)}</div></div>`;
      }).join('');
      items.forEach((el) => {
        const m = L.circleMarker([el.lat, el.lon], { radius: 5, color: '#3b82f6', fillOpacity: .8 })
          .bindPopup(`${el.tags.name} (${fmtMiles(el.dist)})`).addTo(state.map);
        state.poiMarkers.push(m);
      });
      window.__lastPOIs = items; // used by fuel planner
    } else {
      panel.innerHTML = '<span class="muted">No named points of interest found nearby.</span>';
      window.__lastPOIs = [];
    }
  } catch (e) {
    panel.innerHTML = `<span class="muted">POI lookup error: ${e.message}</span>`;
  }
  updateFuelPanel();
}

async function refreshPeaks(traveledMiles) {
  const cache = state.cache;
  const now = Date.now();
  const movedEnough = cache.peaksFetchedAtMiles == null || Math.abs(traveledMiles - cache.peaksFetchedAtMiles) > 8;
  const timeEnough = now - cache.peaksFetchedAt > 8 * 60 * 1000;
  if (!movedEnough && !timeEnough) return;
  cache.peaksFetchedAtMiles = traveledMiles;
  cache.peaksFetchedAt = now;

  const panel = document.getElementById('peaksPanel');
  const cur = state.loc;
  if (!cur) return;
  const radiusM = 64000; // ~40 mi
  const ql = `[out:json][timeout:20];
(
  node["natural"="peak"]["name"]["ele"](around:${radiusM},${cur.lat},${cur.lon});
);
out 60;`;
  try {
    const json = await overpassQuery(ql);
    let items = json.elements.map((el) => {
      const dist = haversineMiles(cur.lat, cur.lon, el.lat, el.lon);
      const brg = bearingDeg(cur.lat, cur.lon, el.lat, el.lon);
      const eleM = parseFloat(el.tags.ele);
      return { name: el.tags.name, eleFt: Math.round(eleM * M_TO_FT), dist, brg, lat: el.lat, lon: el.lon };
    }).filter((el) => !isNaN(el.eleFt));
    items.sort((a, b) => a.dist - b.dist);
    items = items.slice(0, 10);

    clearMarkers(state.peakMarkers);
    if (items.length) {
      panel.innerHTML = items.map((el) => `
        <div class="item-row"><div>
          <div class="item-main">⛰ ${el.name}</div>
          <div class="item-sub">${el.eleFt.toLocaleString()} ft elev · ${compass(el.brg)} of you</div>
        </div><div class="item-right">${fmtMiles(el.dist)}</div></div>`).join('');
      // Only pin the closest few on the map itself (with always-on labels)
      // so it stays readable at a glance; the panel list above still shows
      // all 10 for reference even when off-map.
      items.slice(0, 6).forEach((el) => {
        const icon = L.divIcon({
          className: 'peak-marker',
          html: '<div class="peak-marker-icon">⛰️</div>',
          iconSize: [26, 26],
          iconAnchor: [13, 22],
          tooltipAnchor: [0, -18],
        });
        const m = L.marker([el.lat, el.lon], { icon, keyboard: false })
          .bindTooltip(`${el.name} · ${el.eleFt.toLocaleString()} ft`, { permanent: true, direction: 'top', className: 'peak-tooltip' })
          .bindPopup(`<b>${el.name}</b><br>${el.eleFt.toLocaleString()} ft elevation<br>${fmtMiles(el.dist)} ${compass(el.brg)} of you`)
          .addTo(state.map);
        state.peakMarkers.push(m);
      });
    } else {
      panel.innerHTML = '<span class="muted">No named peaks with elevation data within 40 miles.</span>';
    }
  } catch (e) {
    panel.innerHTML = `<span class="muted">Peak lookup error: ${e.message}</span>`;
  }
}

/* ============================== FUEL PLANNER ============================== */

function updateFuelPanel() {
  const panel = document.getElementById('fuelPanel');
  const range = state.settings.rangeMiles;
  if (!range) {
    panel.innerHTML = '<span class="muted">Set your vehicle range in Settings to enable.</span>';
    return;
  }
  const pois = window.__lastPOIs || [];
  const gas = pois.filter((p) => p.tags && p.tags.amenity === 'fuel').sort((a, b) => a.dist - b.dist);
  if (!gas.length) {
    panel.innerHTML = `<span class="muted">No gas stations found within 15 mi ahead. Your set range is ${range} mi — plan accordingly.</span>`;
    return;
  }
  const nearest = gas[0];
  const within = nearest.dist <= range * 0.8;
  panel.innerHTML = `
    <div class="item-row"><div>
      <div class="item-main">${within ? '✅' : '⚠️'} Next gas: ${nearest.tags.name}</div>
      <div class="item-sub">Based on your set range (${range} mi), not actual fuel level</div>
    </div><div class="item-right">${fmtMiles(nearest.dist)}</div></div>
    ${within ? '' : '<div class="hint">This is farther than 80% of your range — consider topping off before continuing.</div>'}`;
}

/* ============================== DAYLIGHT ============================== */

let lastDaylightFetchAt = 0;
async function refreshDaylight() {
  const cur = state.loc;
  const panel = document.getElementById('daylightPanel');
  if (!cur) return;
  const now = Date.now();
  if (now - lastDaylightFetchAt < 15 * 60 * 1000) return;
  lastDaylightFetchAt = now;
  try {
    const res = await fetch(`https://api.sunrise-sunset.org/json?lat=${cur.lat}&lng=${cur.lon}&formatted=0`);
    const json = await res.json();
    const sunrise = new Date(json.results.sunrise);
    const sunset = new Date(json.results.sunset);
    const nowD = new Date();
    let msg;
    if (nowD < sunrise) msg = `Sunrise at ${sunrise.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} — driving in the dark until then.`;
    else if (nowD > sunset) msg = `Sunset was at ${sunset.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} — it's dark now.`;
    else {
      const hrsLeft = (sunset - nowD) / 3600000;
      msg = `Sunset at ${sunset.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})} — about ${hrsLeft.toFixed(1)}h of daylight left.`;
    }
    panel.innerHTML = `<div>${msg}</div>`;
  } catch (e) {
    panel.innerHTML = '<span class="muted">Daylight info unavailable.</span>';
  }
}

/* ============================== DRIVE TIMER / REST BREAKS ============================== */

function updateDriveTimer() {
  const panel = document.getElementById('breakPanel');
  const d = state.driving;
  const cur = state.loc;
  const speedMph = cur && typeof cur.speed === 'number' && cur.speed >= 0 ? cur.speed * MPS_TO_MPH : null;
  const now = Date.now();

  if (speedMph != null && speedMph > 5) {
    if (d.continuousSince == null) d.continuousSince = now;
    d.stoppedSince = null;
  } else {
    if (d.stoppedSince == null) d.stoppedSince = now;
    if (now - d.stoppedSince > 5 * 60 * 1000) {
      d.continuousSince = null;
      d.lastRestSuggestedAt = null;
    }
  }

  const breakMinutes = state.settings.breakMinutes || 0;
  if (d.continuousSince) {
    const drivingMin = (now - d.continuousSince) / 60000;
    panel.innerHTML = `Driving continuously for <b>${Math.round(drivingMin)} min</b>` +
      (breakMinutes ? ` (break suggested every ${breakMinutes} min)` : '');
    if (breakMinutes && drivingMin >= breakMinutes &&
        (d.lastRestSuggestedAt == null || now - d.lastRestSuggestedAt > 10 * 60 * 1000)) {
      d.lastRestSuggestedAt = now;
      toast(`🛑 You've been driving ${Math.round(drivingMin)} minutes — consider a break soon.`, 12000);
    }
  } else {
    panel.innerHTML = 'Not currently driving (stopped).';
  }
}

/* ============================== VOICE GUIDANCE ============================== */

function voiceSupported() { return 'speechSynthesis' in window; }

// Android Chrome (and some other Chromium builds) has a long-standing bug
// where the speech queue can silently wedge after the phone's screen has
// been locked/unlocked a few times, or just sits a while: speak() stops
// producing any sound but speechSynthesis.speaking reports true forever
// after, with no error and nothing to catch. This is the standard
// workaround most apps hitting that bug use — periodically nudging the
// engine with pause()+resume() so it never gets the chance to wedge shut
// in the first place. Harmless to run all the time: it's a no-op unless
// something is actually (supposedly) speaking.
let voiceKeepAliveTimer = null;
function startVoiceKeepAlive() {
  if (voiceKeepAliveTimer || !voiceSupported()) return;
  voiceKeepAliveTimer = setInterval(() => {
    try {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    } catch (e) { /* ignore */ }
  }, 4000); // was 10000 — a longer message could still hit the cutoff bug (see speak()'s comment) before the first nudge ever fired

}

// Surfaces a voice failure instead of swallowing it silently — throttled
// so a bad patch of driving (or a phone that just doesn't like this
// engine right now) doesn't spam toasts on every single turn.
function reportVoiceFailure(detail) {
  const now = Date.now();
  if (state._lastVoiceErrorToast && now - state._lastVoiceErrorToast < 120000) return;
  state._lastVoiceErrorToast = now;
  toast('🔇 Voice guidance failed' + (detail ? ' (' + detail + ')' : '') + ' — try muting and re-enabling it in Settings.', 6000);
}

// Breaks a message into shorter, sentence-sized pieces and queues each as
// its own utterance, rather than speaking it as one long one. Android
// Chrome has a well-known bug where a single utterance running much past
// ~10-15 seconds can silently cut off mid-sentence with no error fired —
// exactly "it only speaks for a few seconds and cuts off." Several short
// utterances queued back to back are far more reliable: each one finishes
// well under that window, so a cut affects at most one short piece rather
// than losing the rest of the whole message.
const SPEECH_CHUNK_MAX_CHARS = 180;
function splitForSpeech(text) {
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let cur = '';
  for (const s of sentences) {
    if (cur && (cur.length + s.length) > SPEECH_CHUNK_MAX_CHARS) { chunks.push(cur.trim()); cur = ''; }
    cur += s;
    if (cur.length > SPEECH_CHUNK_MAX_CHARS) { chunks.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.length ? chunks : [text];
}

// A ~0.05-second silent WAV, played right before speaking. On some Android
// phones, speechSynthesis alone doesn't reliably hand audio output over to
// a connected Bluetooth car system — actually playing a bit of ordinary
// HTMLMediaElement audio first is a known nudge that helps the OS route
// what follows to the right output, in cases where the car stays silent
// even though the app is clearly trying to talk. This is a best-effort
// mitigation for an OS/Bluetooth-level quirk this app has no direct control
// over, not a guaranteed fix — but it's silent either way, so it's harmless
// to always run before speaking.
let silentAudioEl = null;
function playSilentAudioNudge() {
  try {
    if (!silentAudioEl) {
      silentAudioEl = new Audio('data:audio/wav;base64,UklGRrQBAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YZABAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICA');
      silentAudioEl.volume = 0.01;
    }
    silentAudioEl.currentTime = 0;
    const p = silentAudioEl.play();
    if (p && p.catch) p.catch(() => { /* ignore — best effort only */ });
  } catch (e) { /* ignore */ }
}

function speak(text) {
  if (!voiceSupported() || !state.settings.voiceEnabled) return;
  try {
    window.speechSynthesis.cancel(); // don't let announcements pile up/overlap
    playSilentAudioNudge();
    splitForSpeech(text).forEach((chunk) => {
      const u = new SpeechSynthesisUtterance(chunk);
      u.rate = 1.0;
      u.onerror = (e) => reportVoiceFailure(e && e.error);
      window.speechSynthesis.speak(u);
    });
  } catch (e) { reportVoiceFailure(e && e.message); }
}

// Unlocks audio on browsers (notably iOS Safari) that require the first
// speechSynthesis call to originate from a direct user tap. This alone
// only proves the API *accepted* an utterance, not that anything was
// actually heard — see the audible confirmation phrase spoken right after
// this in wireVoiceControls(), which is what actually catches "I turned it
// on but there was no sound" at setup time instead of an hour into a drive.
function unlockVoice() {
  if (!voiceSupported()) return false;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0.01;
    window.speechSynthesis.speak(u);
    return true;
  } catch (e) { return false; }
}

function updateVoiceButtons() {
  const label = state.settings.voiceEnabled ? '🔊' : '🔇';
  const btn = document.getElementById('voiceToggleBtn');
  if (btn) btn.textContent = label;
}

/* ============================== SCREEN WAKE LOCK ============================== */
// Keeps the phone's screen from timing out while actively navigating —
// the web equivalent of what a native app like Google Maps gets for free.
// This is also the direct fix for how voice guidance went silent on the
// S24: many Android phones auto-lock on detected motion (exactly what a
// phone mounted in a moving car looks like), and a locked/backgrounded tab
// is also what let the Chrome speech engine wedge itself shut in the first
// place — so this addresses the root cause, not just the voice symptom.
let wakeLock = null;

function wakeLockSupported() { return 'wakeLock' in navigator; }

async function requestNavWakeLock() {
  if (!wakeLockSupported() || !state.route) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    // The OS releases it on its own the moment the tab is hidden (screen
    // off, app backgrounded, phone's own power button, etc.) — that's by
    // design and can't be prevented, only re-acquired once the tab is
    // visible again. See the visibilitychange listener in wireWakeLock().
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (e) {
    // Most common causes: the tab isn't visible yet, or battery saver is
    // blocking it. Not worth bothering the driver over — it just retries
    // next time the tab becomes visible or a leg starts.
  }
}

function releaseNavWakeLock() {
  if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
}

function wireWakeLock() {
  if (!wakeLockSupported()) return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestNavWakeLock();
  });
}

/* ============================== MAIN NAVIGATION LOOP ============================== */

// Projects (lat, lon) onto the line segment from (lat1,lon1) to (lat2,lon2),
// clamped to the segment's endpoints, using a local flat-earth
// approximation — plenty accurate over segments this short (route
// geometry points are never more than a few miles apart), and much
// cheaper than doing this properly on a sphere.
function closestPointOnSegment(lat, lon, lat1, lon1, lat2, lon2) {
  const latScale = 69.0; // ~miles per degree of latitude, everywhere
  const lonScale = 69.0 * Math.cos(lat * Math.PI / 180); // miles per degree of longitude, at this latitude
  const dx = (lon2 - lon1) * lonScale, dy = (lat2 - lat1) * latScale;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 0 ? (((lon - lon1) * lonScale) * dx + ((lat - lat1) * latScale) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  return { lat: lat1 + t * (lat2 - lat1), lon: lon1 + t * (lon2 - lon1), t };
}

// Finds where the driver is relative to the route. This measures distance
// to the nearest point ANYWHERE ON the route's line, not just to the
// nearest recorded vertex — a long dead-straight rural highway can have
// vertices a mile or more apart (ORS returns real OSM road geometry, which
// only gets points where the road actually bends), so sitting in the
// middle of one of those stretches used to measure as "half a mile off
// the route" even while driving exactly on it, which is what was
// triggering false "looks like you're taking a different way" prompts.
// idx still lands on one of the two segment endpoints (whichever the
// projected point is nearer to) so the existing cumDist/cumDur/elevation
// lookups elsewhere, which all index by vertex, keep working unchanged —
// only the off-route distance itself was wrong before.
// Shared inner loop: nearest point on any segment between coords[startI]
// and coords[endI] (inclusive of the segment starting at endI - 1).
function nearestIndexInRange(coords, lat, lon, startI, endI) {
  let best = startI, bestD = Infinity;
  for (let i = startI; i < endI; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[i + 1];
    const proj = closestPointOnSegment(lat, lon, lat1, lon1, lat2, lon2);
    const d = haversineMiles(lat, lon, proj.lat, proj.lon);
    if (d < bestD) { bestD = d; best = proj.t < 0.5 ? i : i + 1; }
  }
  return { idx: best, dist: bestD };
}

// How far around the last known position to search before trusting the
// result — see the windowing comment below.
const NEAREST_WINDOW_BACK_MILES = 0.5;
const NEAREST_WINDOW_FORWARD_MILES = 5;
const NEAREST_WINDOW_TRUST_MILES = 0.25;

function findNearestIndex(lat, lon) {
  const { coords, cumDist } = state.route;
  if (coords.length < 2) return { idx: 0, dist: coords.length ? haversineMiles(lat, lon, coords[0][1], coords[0][0]) : Infinity };

  // Search only a window around where the driver was last known to be,
  // rather than the whole route, before falling back to a full search.
  // This matters most at complex highway interchanges: an off-ramp can run
  // for a stretch just a few dozen meters from the mainline it's splitting
  // from, which a plain nearest-point-on-the-whole-route search has no way
  // to tell apart from the correct, further-along point on the ramp/
  // mainline actually being driven — it can snap back onto an earlier part
  // of the route that just happens to be physically closer, which then
  // reports the WRONG upcoming turn instruction (an earlier "keep right"
  // instead of the real next turn) even while the distance countdown to it
  // keeps ticking down normally, since both points are moving the same
  // direction. Restricting the search to a window keeps that earlier,
  // wrong-but-nearby geometry out of contention entirely. The window is
  // widened well past normal one-fix-to-the-next travel distance (even at
  // highway speed) so ordinary driving, and a stretch of poor/lost GPS
  // signal, never falsely triggers the full-search fallback below.
  const traveled = cumDist[nearestIndexCache] || 0;
  const backIdx = coordAtDistance(Math.max(0, traveled - NEAREST_WINDOW_BACK_MILES)).idx;
  const fwdIdx = coordAtDistance(traveled + NEAREST_WINDOW_FORWARD_MILES).idx;
  const windowed = nearestIndexInRange(coords, lat, lon, backIdx, Math.max(backIdx + 1, fwdIdx));
  if (windowed.dist <= NEAREST_WINDOW_TRUST_MILES) return windowed;

  // Nothing close enough nearby to trust — the very first fix of a leg
  // (nearestIndexCache still 0, so the window above already covers the
  // route's start anyway), or the driver is genuinely well off this
  // window's stretch of the route (a real wrong turn, well past the
  // windowed search's reach). Fall back to checking the entire route.
  return nearestIndexInRange(coords, lat, lon, 0, coords.length - 1);
}

// Reads elevation (in feet) at the driver's current position on the route,
// using the elevation ORS already returned with the route coordinates
// (requested via elevation:true in orsRoute()) rather than a phone's own
// GPS altitude, which is often missing or inaccurate. Returns null if no
// elevation data is available (e.g. route not loaded yet, or the ORS
// response didn't include it).
function currentElevationFt() {
  if (!state.route || !state.route.coords) return null;
  const pt = state.route.coords[nearestIndexCache];
  const elevM = pt && pt.length >= 3 ? pt[2] : null;
  return typeof elevM === 'number' ? Math.round(elevM * M_TO_FT) : null;
}

const REROUTE_TRIGGER_MILES = 0.5;
// Hysteresis: has to come back closer than this to count as "back on route"
// again — otherwise normal GPS wobble right around the trigger distance
// would flicker the offer banner on and off repeatedly.
const REROUTE_CLEAR_MILES = 0.3;

// Decides what to do when the driver is off the calculated route — either
// recalculate right away (old behavior, Settings → "Reroute automatically"),
// or, by default, surface an on-screen (and spoken, once) offer and let the
// driver decide — see offerReroute()/wireRerouteOffer(). Either way this
// itself never blocks the caller; the 'ask' path always returns false
// (nothing changed yet) and the actual reroute happens later from the
// banner/chip tap, via performReroute().
async function maybeReroute(offRouteMiles, curLat, curLon) {
  if (offRouteMiles < REROUTE_CLEAR_MILES) {
    if (state.rerouteOfferState !== 'none') {
      state.rerouteOfferState = 'none';
      state.rerouteOffer = null;
      renderRerouteOffer();
    }
    return false;
  }
  if (offRouteMiles < REROUTE_TRIGGER_MILES) return false;

  if ((state.settings.rerouteMode || 'ask') === 'auto') {
    const now = Date.now();
    if (now - state.lastRerouteAt < 2 * 60 * 1000) return false;
    state.lastRerouteAt = now;
    toast('You appear off-route — recalculating…', 5000);
    speak('Recalculating route.');
    return await performReroute(curLat, curLon);
  }

  // 'ask' mode: keep the reroute-from point fresh in case the driver taps
  // the offer a while after first drifting off, then show whichever level
  // of prompt is due — the full banner the first time this deviation is
  // noticed, otherwise (already declined once) just leave the quiet chip
  // up rather than re-asking.
  state.rerouteOffer = { lat: curLat, lon: curLon };
  if (state.rerouteOfferState === 'none') {
    state.rerouteOfferState = 'prompt';
    toast("Looks like you're taking a different way.", 5000);
    speak('You appear to be off your route. Tap Reroute if you\'d like new directions.');
  }
  renderRerouteOffer();
  return false;
}

// Does the actual recalculation — shared by both the automatic path and
// the driver tapping "🔄 Reroute" on the offer banner/chip.
async function performReroute(curLat, curLon) {
  try {
    const dest = state.route.destForReroute;
    const newRoute = await calcRouteWithPreference({ lat: curLat, lon: curLon }, dest);
    newRoute.destForReroute = dest;
    state.route = newRoute;
    state.announced = new Set();
    state.arrivalAnnounced = false;
    // A reroute is a brand-new route array starting from right here, so
    // the "nearest point" search needs to start over from its beginning
    // too — see findNearestIndex()'s windowed search, which otherwise
    // would keep searching near whatever index was current on the OLD
    // route, a stale and likely out-of-range/wrong position on the new one.
    nearestIndexCache = 0;
    drawRoute(true);
    persistActiveLeg(); // the route just changed — keep the overnight-resume snapshot current
    if (state.share.active) {
      // Send the new route to anyone watching too — see
      // maybePushShareLocation() for why this can't just wait for the
      // usual periodic location push to happen to include it.
      state.share.routeDirty = true;
      maybePushShareLocation();
    }
    const choiceMsg = describeRouteChoice(newRoute);
    if (choiceMsg) toast(choiceMsg, 6000);
    return true;
  } catch (e) {
    toast('Reroute failed: ' + e.message, 6000);
    return false;
  }
}

function renderRerouteOffer() {
  const banner = document.getElementById('rerouteOfferBanner');
  const chip = document.getElementById('rerouteOfferChip');
  if (banner) banner.classList.toggle('hidden', state.rerouteOfferState !== 'prompt');
  if (chip) chip.classList.toggle('hidden', state.rerouteOfferState !== 'declined');
}

function wireRerouteOffer() {
  const yesBtn = document.getElementById('rerouteOfferYesBtn');
  const noBtn = document.getElementById('rerouteOfferNoBtn');
  const chip = document.getElementById('rerouteOfferChip');
  if (!yesBtn || !noBtn || !chip) return;

  const acceptOffer = async () => {
    const offer = state.rerouteOffer;
    if (!offer) return;
    state.rerouteOfferState = 'none';
    state.rerouteOffer = null;
    renderRerouteOffer();
    state.lastRerouteAt = Date.now();
    toast('Recalculating…', 4000);
    await performReroute(offer.lat, offer.lon);
  };

  yesBtn.addEventListener('click', acceptOffer);
  chip.addEventListener('click', acceptOffer);
  noBtn.addEventListener('click', () => {
    // Stays quiet (no more banner or voice prompt) for this same deviation,
    // but the small chip sticks around so changing your mind later is still
    // one tap away — see maybeReroute()'s REROUTE_CLEAR_MILES reset.
    state.rerouteOfferState = 'declined';
    renderRerouteOffer();
  });
}

const VOICE_ANNOUNCE_MILES = 1.0; // baseline "heads up" distance — floor, never less than this even at low speed
const VOICE_IMMINENT_MILES = 0.25; // baseline "right now" distance — same, floor only

// A FIXED distance is a SHRINKING amount of warning time the faster you're
// going — 0.25 miles is about 30 seconds at 30mph, but only about 11
// seconds at 80mph, which is backwards from what's actually needed (more
// reaction/lane-change time at highway speed, not less). That mismatch is
// what made an announcement land "as I'm passing the turn" at interstate
// speed rather than clearly before it — the announcement wasn't wrong or
// late by the app's own (distance) yardstick, it just didn't correspond to
// enough real seconds once going fast enough. Past
// VOICE_SCALE_ABOVE_MPH (the speed at which the fixed-mile floors above
// already work out to this many seconds anyway, so this never shortens
// anything relative to before), both distances grow with your actual speed
// so they represent a roughly constant number of *seconds* of warning —
// VOICE_ANNOUNCE_LEAD_SECONDS_FAR / _NEAR — no matter how fast you're
// driving, instead of the same fixed distance meaning less and less time
// the faster you go.
const VOICE_ANNOUNCE_LEAD_SECONDS_FAR = 60;
const VOICE_ANNOUNCE_LEAD_SECONDS_NEAR = 15;

function voiceAnnounceThresholds(speedMph) {
  if (typeof speedMph !== 'number' || speedMph <= 0) {
    return { far: VOICE_ANNOUNCE_MILES, near: VOICE_IMMINENT_MILES };
  }
  const milesPerSecond = speedMph / 3600;
  return {
    far: Math.max(VOICE_ANNOUNCE_MILES, milesPerSecond * VOICE_ANNOUNCE_LEAD_SECONDS_FAR),
    near: Math.max(VOICE_IMMINENT_MILES, milesPerSecond * VOICE_ANNOUNCE_LEAD_SECONDS_NEAR),
  };
}

function announceStepIfDue(stepIdx, step, distToManeuver, speedMph) {
  if (!state.announced) state.announced = new Set();
  const { far, near } = voiceAnnounceThresholds(speedMph);
  const farKey = stepIdx + '_far';
  const nearKey = stepIdx + '_near';
  if (distToManeuver <= far && !state.announced.has(farKey)) {
    state.announced.add(farKey);
    speak(`In ${fmtMiles(distToManeuver)}, ${step.instruction}.`);
  }
  if (distToManeuver <= near && !state.announced.has(nearKey)) {
    state.announced.add(nearKey);
    speak(step.instruction + '.');
  }
}

async function onLocationUpdate() {
  const cur = state.loc;
  if (!cur) return;

  if (state.map) {
    if (!state.currentMarker) {
      state.currentMarker = L.marker([cur.lat, cur.lon], { title: 'You' }).addTo(state.map);
    } else {
      state.currentMarker.setLatLng([cur.lat, cur.lon]);
    }
    // Keep the map centered on the driver as they move, unless they've
    // manually dragged it to look around — see the dragstart handler and
    // the "Recenter" button in initMap()/addRecenterControl().
    if (state.followMe) {
      state.map.panTo([cur.lat, cur.lon], { animate: true, duration: 0.5 });
    }
  }

  if (!state.route) return;

  checkUSStateCrossing(cur);
  checkUSCityCrossing(cur);
  checkUSTimezoneCrossing(cur);

  const { idx, dist } = findNearestIndex(cur.lat, cur.lon);
  nearestIndexCache = idx;
  const traveled = state.route.cumDist[idx];
  const total = state.route.totalDist;
  const remaining = Math.max(0, total - traveled);

  document.getElementById('statMilesLeft').textContent = fmtMiles(remaining);
  renderTripProgressBar('tripProgressFill', 'tripProgressPct', traveled, total);

  const remainingDur = Math.max(0, state.route.totalDur - state.route.cumDur[idx]);
  document.getElementById('statEta').textContent = fmtClockFromNowPlus(remainingDur);
  document.getElementById('statEtaDate').textContent = etaDateLabel(remainingDur);

  const speedMph = typeof cur.speed === 'number' && cur.speed >= 0 ? cur.speed * MPS_TO_MPH : null;
  document.getElementById('statSpeed').textContent = speedMph != null ? Math.round(speedMph) : '–';
  updateBaseLayerForSpeed(speedMph);

  // Elevation comes straight from the route ORS already returned (requested
  // with elevation:true — see orsRoute()) rather than a phone's own GPS
  // altitude reading, which is notoriously inaccurate/often missing
  // entirely on most phones. Reads instantly off the same nearest-point
  // lookup used for progress/ETA above, so there's no extra network call
  // and no delay as you drive.
  const elevFt = currentElevationFt();
  document.getElementById('statElevation').textContent = elevFt != null ? elevFt.toLocaleString() + ' ft' : '–';

  // Determine current/next step. `steps[stepIdx]` is the road you're
  // actually driving on right now — but ORS's instruction for a step
  // describes the maneuver that put you onto that road (i.e. the turn you
  // already made), not the turn coming up. The upcoming maneuver is
  // described by the NEXT step, which begins exactly where the current one
  // ends — the same point distToManeuver already counts down to. So the
  // distance is measured off stepIdx, but the instruction shown/spoken has
  // to come from stepIdx + 1, or this always reads one turn stale (correct
  // distance, wrong street/direction — see the "turn right" pic that was
  // actually the next-to-last turn).
  const steps = state.route.steps;
  let stepIdx = steps.findIndex((s) => idx <= s.way_points[1]);
  if (stepIdx === -1) stepIdx = steps.length - 1;
  state.currentStepIndex = stepIdx;
  const step = steps[stepIdx];
  const upcomingStepIdx = Math.min(stepIdx + 1, steps.length - 1);
  const upcomingStep = steps[upcomingStepIdx];
  const distToManeuver = Math.max(0, state.route.cumDist[step.way_points[1]] - traveled);
  document.getElementById('statNextTurn').textContent = upcomingStep.instruction;
  document.getElementById('statNextTurnDist').textContent = 'in ' + fmtMiles(distToManeuver);

  renderSteps(upcomingStepIdx);
  announceStepIfDue(upcomingStepIdx, upcomingStep, distToManeuver, speedMph);

  if (remaining < 0.05) {
    if (!state.arrivalAnnounced) {
      state.arrivalAnnounced = true;
      toast('🎉 You have arrived! Tap "🏁 End This Leg / Plan Next Leg" below when you\'re ready to plan the next stretch.', 10000);
      speak('You have arrived at your destination.');
    }
  }

  const rerouted = await maybeReroute(dist, cur.lat, cur.lon);
  if (!rerouted) {
    refreshWeatherAndAlerts(traveled, total);
    refreshPOIs(traveled);
    refreshPeaks(traveled);
    refreshDaylight();
  }
  updateDriveTimer();

  // Forgive forgetting to tap "Resume Sharing" the next morning — once
  // you've actually driven a bit from where you paused, there's no real
  // ambiguity that you're back on the road, so pick it back up on its own
  // rather than leaving family looking at a "taking a break" message
  // indefinitely.
  if (state.share.active && state.share.paused && state.share.pausedLoc) {
    const movedMiles = haversineMiles(state.share.pausedLoc.lat, state.share.pausedLoc.lon, cur.lat, cur.lon);
    if (movedMiles > 0.3) resumeSharingFromPause(true);
  }

  maybePushShareLocation();
}

// Remembers what was last drawn so renderSteps() below can tell "nothing
// actually changed" (called again for the same current step, which is most
// GPS updates — a turn is usually minutes away, not seconds) from "the
// current step just advanced" or "this is a new route's step list
// entirely." Only those latter two cases touch the DOM or auto-scroll —
// see the comment on the scrollIntoView call below for why that matters.
let lastRenderedSteps = null;
let lastRenderedStepIdx = null;

function renderSteps(currentIdx) {
  const panel = document.getElementById('stepsPanel');
  const steps = state.route.steps;
  const isNewStepsList = steps !== lastRenderedSteps;
  if (!isNewStepsList && currentIdx === lastRenderedStepIdx) return; // nothing to do — see comment above

  if (isNewStepsList) {
    panel.innerHTML = steps.map((s, i) => `
      <div class="step-item ${i === currentIdx ? 'current' : ''}">
        ${s.instruction}
        <div class="step-dist">${fmtMiles(s.distance)}${s.name && s.name !== '-' ? ' on ' + s.name : ''}</div>
      </div>`).join('');
  } else {
    // Same list, just a different current step — flip the highlight
    // without rebuilding the whole panel, so nothing here disturbs
    // wherever the reader has scrolled to.
    const items = panel.querySelectorAll('.step-item');
    if (items[lastRenderedStepIdx]) items[lastRenderedStepIdx].classList.remove('current');
    if (items[currentIdx]) items[currentIdx].classList.add('current');
  }
  lastRenderedSteps = steps;
  lastRenderedStepIdx = currentIdx;

  // Auto-scroll only happens here — when the current step actually changed
  // (a real turn was just reached) or a brand new route just loaded — never
  // on an unrelated GPS update for a step that hasn't moved. Previously
  // this ran on every single location update regardless, which fought
  // anyone trying to scroll down to read ahead: the list would jump back
  // to the current turn every few seconds even though nothing had actually
  // changed yet.
  const activeEl = panel.querySelectorAll('.step-item')[currentIdx];
  if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
}

/* ============================== MAP ============================== */

// Speed thresholds (mph) with hysteresis so the view doesn't flap back and
// forth near a single cutoff (e.g. in stop-and-go traffic around 45mph).
const SAT_TO_STREET_BELOW_MPH = 40;
const STREET_TO_SAT_ABOVE_MPH = 50;
const LAYER_SWITCH_DWELL_MS = 6000; // speed must hold past the threshold this long before switching

function initMap() {
  state.map = L.map('map', { zoomControl: true }).setView([34.5, -111.5], 6); // AZ-ish default

  // Two custom panes so the route line renders *underneath* the road/place
  // name reference layers below, instead of Leaflet's default stacking
  // (any polyline sits in 'overlayPane', z-index 400 — above every tile
  // layer, z-index 200, no matter what order they were added in). Without
  // this, the route line would always cover any street name or highway
  // shield it happened to run directly along, no matter how thin or
  // transparent it's drawn. 'routePane' sits just above the base
  // imagery/street tiles; 'roadLabelsPane' (created below, used by
  // satRoadsLayer/satLabelsLayer) sits above that, so those labels are
  // always legible over the route line in satellite mode. Markers (your
  // position, POI/peak pins, photo/comment pins) stay in Leaflet's default
  // markerPane (z-index 600) and are unaffected — still on top of
  // everything, as before.
  state.map.createPane('routePane');
  state.map.getPane('routePane').style.zIndex = 300;
  state.map.createPane('roadLabelsPane');
  state.map.getPane('roadLabelsPane').style.zIndex = 350;

  // Both base layers are added up front and kept loaded; switching between
  // them just toggles opacity instead of removing/re-adding a layer, so
  // there's no flash-to-gray / tile refetch stutter when the view changes.
  state.streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(state.map);

  state.satLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Imagery &copy; Esri',
    maxZoom: 19,
  }).addTo(state.map);

  // Road network + street name labels drawn on top of the satellite
  // imagery, so satellite mode actually shows street names as you get
  // close in, rather than a bare aerial photo. Street mode doesn't need
  // this layer at all — the OSM street tiles above already have street
  // names baked in. Added before satLabelsLayer below so place-name labels
  // stack on top of road labels, not the other way around (Esri's own
  // recommended stacking order for a satellite-hybrid map).
  // pane: 'roadLabelsPane' (created above) is what keeps this layer's
  // street names and highway shields legible over the route line — see
  // that pane's comment.
  state.satRoadsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri',
    maxZoom: 19,
    pane: 'roadLabelsPane',
  }).addTo(state.map);

  // Place-name/boundary labels drawn on top of both the imagery and the
  // road layer above — city, county, and water body names. Same pane as
  // satRoadsLayer (added after it, so it stacks on top within that pane).
  state.satLabelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri',
    maxZoom: 19,
    pane: 'roadLabelsPane',
  }).addTo(state.map);

  state.effectiveLayer = 'satellite';
  state.streetLayer.setOpacity(0);
  state.satLayer.setOpacity(1);
  state.satLabelsLayer.setOpacity(1);
  state.satRoadsLayer.setOpacity(1);

  state.mapLayerMode = 'auto'; // 'auto' | 'satellite' | 'street' (manual lock)
  state.layerSwitch = { belowSince: null, aboveSince: null };

  const LayerToggleControl = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar map-toggle-btn');
      div.innerText = layerControlLabel();
      div.title = 'Click to cycle: Auto (switches with speed) / Satellite / Street';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div, 'click', () => {
        cycleLayerMode();
        div.innerText = layerControlLabel();
      });
      state.layerToggleDiv = div;
      return div;
    },
  });
  new LayerToggleControl().addTo(state.map);

  state.mapFullscreen = false;
  addFullscreenToggleControl(state.map, () => state.mapFullscreen, toggleMapFullscreen);

  // Auto-follow: the map recenters on your location as you drive (see
  // onLocationUpdate()). Dragging the map to look around turns that off —
  // Leaflet's 'dragstart' only fires for the user's own touch/mouse drag,
  // never for the programmatic panTo() calls that follow mode itself makes —
  // and the Recenter button turns it back on.
  state.followMe = true;
  addRecenterControl(
    state.map,
    (v) => { state.followMe = v; },
    () => state.loc && [state.loc.lat, state.loc.lon],
    (div) => { state.recenterBtnDiv = div; },
  );
  state.map.on('dragstart', () => {
    if (state.followMe) {
      state.followMe = false;
      if (state.recenterBtnDiv) state.recenterBtnDiv.classList.remove('hidden');
    }
  });

  // Tap-anywhere-for-ETA — see handleMapTapForEta(). Leaflet doesn't fire
  // 'click' after an actual drag, and marker/popup clicks stop propagation
  // before reaching the map, so this only fires for a genuine tap on open
  // map area.
  state.map.on('click', (e) => { handleMapTapForEta(e.latlng.lat, e.latlng.lng); });

  addMapHelpControl(state.map, 'map-driver');

  drawTimezoneLines(state.map);
}

// A small on-map button that appears once the map has been manually panned
// away from whatever it was following — the driver's own location on the
// main map, or the traveler's live position on a viewer's watch map (see
// initWatchMap()). Tapping it snaps back and resumes auto-follow. Shared by
// both maps via getFollowing/setFollowing/getTargetLatLng so each keeps its
// own independent follow state.
function addRecenterControl(map, setFollowing, getTargetLatLng, onDivReady) {
  const RecenterControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar map-toggle-btn recenter-btn hidden');
      div.innerText = '⌖ Recenter';
      div.title = 'Re-center the map and resume auto-follow';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div, 'click', () => {
        setFollowing(true);
        div.classList.add('hidden');
        const ll = getTargetLatLng();
        if (ll) map.panTo(ll, { animate: true });
      });
      if (onDivReady) onDivReady(div);
      return div;
    },
  });
  return new RecenterControl().addTo(map);
}

// Shared by both the driver's own map and a viewer's watch map — a small
// on-map control that expands the map to fill the screen and hides
// everything else, then flips back. `isFullscreen`/`toggle` let each map
// keep its own independent fullscreen state.
function addFullscreenToggleControl(map, isFullscreen, toggle) {
  const label = () => (isFullscreen() ? '↙ Exit Full Map' : '⛶ Full Map');
  const FullscreenToggleControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar map-toggle-btn');
      div.innerText = label();
      div.title = 'Expand the map to full screen, or return to the normal view';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div, 'click', () => {
        toggle();
        div.innerText = label();
      });
      return div;
    },
  });
  return new FullscreenToggleControl().addTo(map);
}

function toggleMapFullscreen() {
  state.mapFullscreen = !state.mapFullscreen;
  document.getElementById('dashboard').classList.toggle('map-fullscreen', state.mapFullscreen);
  // The map's container just changed size via CSS; Leaflet needs to be told
  // so it re-measures and doesn't leave stale/partial tiles at the edges.
  setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 50);
}

function toggleWatchFullscreen() {
  state.watch.fullscreen = !state.watch.fullscreen;
  document.getElementById('watchScreen').classList.toggle('watch-fullscreen', state.watch.fullscreen);
  setTimeout(() => { if (state.watch.map) state.watch.map.invalidateSize(); }, 50);
}

function layerControlLabel() {
  const icon = state.effectiveLayer === 'satellite' ? '🛰️ Satellite' : '🗺️ Street';
  if (state.mapLayerMode === 'auto') return icon + ' (Auto)';
  return icon + ' (Locked)';
}

function refreshLayerControlLabel() {
  if (state.layerToggleDiv) state.layerToggleDiv.innerText = layerControlLabel();
}

function setEffectiveLayer(layer) {
  if (state.effectiveLayer === layer) return;
  state.effectiveLayer = layer;
  const showSat = layer === 'satellite';
  state.satLayer.setOpacity(showSat ? 1 : 0);
  state.satLabelsLayer.setOpacity(showSat ? 1 : 0);
  state.satRoadsLayer.setOpacity(showSat ? 1 : 0);
  state.streetLayer.setOpacity(showSat ? 0 : 1);
  refreshLayerControlLabel();
}

function cycleLayerMode() {
  state.mapLayerMode = state.mapLayerMode === 'auto' ? 'satellite'
    : state.mapLayerMode === 'satellite' ? 'street' : 'auto';
  if (state.mapLayerMode === 'satellite') setEffectiveLayer('satellite');
  else if (state.mapLayerMode === 'street') setEffectiveLayer('street');
  else {
    // Re-entering auto: reset the dwell timers so it re-evaluates cleanly
    // from the next location update rather than switching instantly.
    state.layerSwitch.belowSince = null;
    state.layerSwitch.aboveSince = null;
  }
  refreshLayerControlLabel();
}

function updateBaseLayerForSpeed(speedMph) {
  if (state.mapLayerMode !== 'auto' || speedMph == null) return;
  const now = Date.now();
  const ls = state.layerSwitch;
  if (speedMph < SAT_TO_STREET_BELOW_MPH) {
    ls.aboveSince = null;
    if (ls.belowSince == null) ls.belowSince = now;
    if (state.effectiveLayer !== 'street' && now - ls.belowSince > LAYER_SWITCH_DWELL_MS) setEffectiveLayer('street');
  } else if (speedMph > STREET_TO_SAT_ABOVE_MPH) {
    ls.belowSince = null;
    if (ls.aboveSince == null) ls.aboveSince = now;
    if (state.effectiveLayer !== 'satellite' && now - ls.aboveSince > LAYER_SWITCH_DWELL_MS) setEffectiveLayer('satellite');
  } else {
    // Dead zone between thresholds: don't count time toward a switch either way.
    ls.belowSince = null;
    ls.aboveSince = null;
  }
}

function drawRoute(isReroute) {
  if (state.routeLine) state.map.removeLayer(state.routeLine);
  const latlngs = state.route.coords.map((c) => [c[1], c[0]]);
  // pane: 'routePane' (see initMap()) draws this underneath the road/place
  // name reference layers, so street names and highway shields the route
  // runs along always stay legible regardless of the line's own weight/
  // opacity — reduced opacity alone (tried in an earlier version) still
  // left labels washed out since the line was rendering on top of them no
  // matter what. Kept slightly less than fully opaque anyway since it's
  // still drawn above the base satellite/street imagery itself.
  state.routeLine = L.polyline(latlngs, { color: '#3b82f6', weight: 5, opacity: 0.8, pane: 'routePane' }).addTo(state.map);

  // The route geometry's last point is wherever the road network snapped
  // to (the nearest point ORS can actually drive to) — this can land
  // noticeably away from the pin you picked/dragged if that spot isn't on
  // a mapped, routable road (common for internal complex/HOA roads that
  // OpenStreetMap doesn't have marked as driveable). Show both points so
  // that gap is visible instead of silently ending up somewhere unexpected.
  if (state.destMarker) state.map.removeLayer(state.destMarker);
  if (state.pinMarker) state.map.removeLayer(state.pinMarker);

  const destC = state.route.coords[state.route.coords.length - 1];
  state.destMarker = L.marker([destC[1], destC[0]])
    .bindPopup('Route ends here (nearest drivable road)')
    .addTo(state.map);

  const pin = state.route.destForReroute;
  const gapMiles = pin ? haversineMiles(pin.lat, pin.lon, destC[1], destC[0]) : 0;
  if (pin && gapMiles > 0.03) {
    const icon = L.divIcon({
      className: 'pin-marker',
      html: '<div class="pin-marker-icon">🏠</div>',
      iconSize: [26, 26],
      iconAnchor: [13, 24],
    });
    state.pinMarker = L.marker([pin.lat, pin.lon], { icon })
      .bindPopup(`Your destination pin<br>${fmtMiles(gapMiles)} from the nearest drivable road`)
      .addTo(state.map);
    if (gapMiles > 0.1) {
      toast(`⚠️ The road network's closest drivable point is about ${fmtMiles(gapMiles)} from your exact pin (🏠). You may need to finish on foot or double check the spot.`, 10000);
    }
  } else {
    state.pinMarker = null;
  }

  // Skip the re-fit on a reroute — a reroute only spans from here to the
  // destination, so re-fitting bounds on every one would yank your own
  // view away from wherever you'd panned to (e.g. looking back at photo
  // pins from earlier in the drive) and crop the map down to just the
  // remaining leg, same issue this caused on family's watch screens (see
  // renderWatchTrip()). You're normally in auto-follow anyway, which
  // recenters on your live position regardless of this.
  if (!isReroute) {
    const bounds = state.pinMarker
      ? state.routeLine.getBounds().extend(state.pinMarker.getLatLng())
      : state.routeLine.getBounds();
    state.map.fitBounds(bounds, { padding: [30, 30] });
  }
}

/* ============================== FIREBASE / TRIP SHARING ============================== */
// Optional feature: lets other people watch your live position, photos,
// videos, and comments during a leg by entering a passcode. Requires a free
// Firebase project — see firebase-config.js and README.md section 7.
// Nothing here runs, and no network calls are made, until that config is
// filled in.
//
// Deliberately Firestore-only, no Firebase Storage: Google now requires the
// paid Blaze plan just to turn Storage on (even though usage within the free
// quota costs nothing), while Firestore itself stays free (Spark plan, no
// card needed). So photos are compressed client-side and stored as base64
// text directly in a Firestore document instead of as an uploaded file —
// that caps what fits (Firestore documents max out at 1MB), comfortably
// enough for a compressed photo but not a video. Video is instead handled
// as a link: record it normally, upload to Google Drive (or similar) with
// "anyone with the link" sharing, and paste that link in — only the tiny
// URL string is stored in Firestore, so this stays free too.

function firebaseConfigured() {
  const c = window.FIREBASE_CONFIG;
  return !!(c && c.apiKey && !String(c.apiKey).startsWith('YOUR_'));
}

// How long to wait for Firebase sign-in before giving up and letting the
// caller (startSharing()/resumeSharing()/etc.) show a retryable error,
// instead of leaving the UI stuck on "Connecting…" forever. This matters
// most on a spotty connection (e.g. a satellite dish mid-handover) where a
// request can sit neither succeeding nor failing for a long time — without
// this, there's simply no error to catch and show.
const FIREBASE_CONNECT_TIMEOUT_MS = 20000;

// Same reasoning as initFirebase()'s own timeout, applied to the individual
// Firestore reads/writes in the sharing flow (generateUniquePin's lookups,
// the initial trip doc write, resuming an existing share) — signing in can
// succeed fine on a shaky connection while the very next network call still
// hangs with neither a success nor an error, which otherwise leaves the UI
// stuck on "Connecting…" indefinitely with no way to retry short of
// reloading the whole page.
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

// A satellite connection (Starlink included) can drop packets for a second
// or two around a routine dish handover — brief enough that a plain retry
// a couple seconds later often just works, but long enough to fully stall
// out a single request. Rather than making the driver notice the error and
// tap "Start Sharing" again by hand (awkward mid-drive), the caller retries
// automatically this many times before actually giving up and showing an
// error with its own manual retry button.
const SHARE_CONNECT_RETRIES = 2;

let fbInitPromise = null;
function initFirebase() {
  if (fbInitPromise) return fbInitPromise;
  fbInitPromise = new Promise((resolve, reject) => {
    if (!firebaseConfigured()) return reject(new Error("Trip sharing isn't set up yet — see README.md section 7."));
    if (typeof firebase === 'undefined') return reject(new Error('Firebase library failed to load — check your connection and reload.'));
    try {
      const app = (firebase.apps && firebase.apps.length) ? firebase.app() : firebase.initializeApp(window.FIREBASE_CONFIG);
      const auth = firebase.auth(app);
      const db = firebase.firestore(app);
      // Firestore's default connection is a long-lived, streaming one
      // (WebChannel over HTTP/2) — ordinary page loads and API calls (like
      // OpenRouteService's) don't need anything like it, which is exactly
      // why "other sites work fine" doesn't rule this out. Some networks
      // (corporate proxies, some VPNs, and some satellite/cellular
      // connections — Starlink's routing/NAT among them, based on reports
      // from other users) silently swallow that connection instead of
      // rejecting it outright, so it just hangs forever with no error to
      // show. This tells Firestore to detect that and fall back to plain,
      // ordinary HTTPS long-polling automatically when needed, which works
      // through those same networks fine — only applies to the very first
      // time this runs since it has to happen before any other Firestore
      // call, which is why it lives here in initFirebase() and nowhere else.
      try { db.settings({ experimentalAutoDetectLongPolling: true }); } catch (e) { /* already configured — fine, ignore */ }
      const timer = setTimeout(() => {
        reject(new Error("Couldn't connect (signing in) — check your signal and try again."));
      }, FIREBASE_CONNECT_TIMEOUT_MS);
      auth.onAuthStateChanged((user) => {
        if (user) { clearTimeout(timer); state.fb = { app, auth, db, uid: user.uid }; resolve(state.fb); }
      });
      auth.signInAnonymously().catch((e) => { clearTimeout(timer); reject(new Error('Firebase sign-in failed: ' + e.message)); });
    } catch (e) { reject(e); }
  }).catch((e) => {
    // Don't let one failed/timed-out attempt poison every later retry —
    // without this, tapping Start Sharing again after a connection hiccup
    // would just keep re-returning this same already-failed promise
    // forever, making a fresh attempt (even after the connection recovers)
    // impossible without a full page reload.
    fbInitPromise = null;
    throw e;
  });
  return fbInitPromise;
}

function randomPin() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function generateUniquePin(db, uid) {
  for (let i = 0; i < 6; i++) {
    const pin = randomPin();
    const snap = await withTimeout(db.collection('trips').doc(pin).get(), FIREBASE_CONNECT_TIMEOUT_MS, "Couldn't connect (checking passcode availability) — check your signal and try again.");
    if (!snap.exists) return pin;
    const data = snap.data();
    if (data.ownerUid === uid || data.active === false) return pin; // safe to reuse
  }
  return randomPin(); // extremely unlikely to still collide
}

// Firestore documents are capped at 1MB; a multi-day route can have
// thousands of coordinate points, so thin it down to a shape that's still
// plenty smooth on a viewer's map. Points are stored as {lat, lon} objects
// rather than [lat, lon] pairs because Firestore flatly rejects an array
// that contains other arrays ("nested arrays are not supported") — an
// array of maps is fine, an array of arrays is not.
//
// Each point also carries cumDist/cumDur (miles / seconds from the route's
// start) so a viewer — who has no ORS key of their own — can still estimate
// a tap-for-ETA by comparing the tapped point's cumDist/cumDur against the
// traveler's own nearest sample point. See handleWatchMapTapForEta().
function sampleRouteForShare(route, maxPoints) {
  maxPoints = maxPoints || 300;
  const { coords, cumDist, cumDur } = route;
  const toPoint = (i) => {
    const p = { lat: coords[i][1], lon: coords[i][0], cumDist: cumDist[i], cumDur: cumDur[i] };
    // Elevation (3rd coord value, meters) rides along here so a viewer —
    // who has no ORS key to look it up live — can still show an
    // approximate elevation on their tap-for-ETA popup. See
    // handleWatchMapTapForEta().
    if (typeof coords[i][2] === 'number') p.elevFt = Math.round(coords[i][2] * M_TO_FT);
    return p;
  };
  if (coords.length <= maxPoints) return coords.map((c, i) => toPoint(i));
  const out = [];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    out.push(toPoint(idx));
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function startSharing() {
  const panel = document.getElementById('sharePanel');
  if (!state.route) { toast('Calculate a route first.', 4000); return; }

  // Retries automatically a couple of times before actually giving up —
  // see SHARE_CONNECT_RETRIES's comment. Each attempt still has its own
  // 20-second timeout (see withTimeout() calls below/in generateUniquePin),
  // so a genuinely broken connection still gives up in well under a minute
  // total rather than hanging indefinitely.
  let lastError = null;
  for (let attempt = 1; attempt <= SHARE_CONNECT_RETRIES + 1; attempt++) {
    panel.innerHTML = `<span class="muted">Connecting${attempt > 1 ? ` (retry ${attempt - 1} of ${SHARE_CONNECT_RETRIES})` : ''}…</span>`;
    try {
      const { db, uid } = await initFirebase();
      const pin = await generateUniquePin(db, uid);
      const routeCoords = sampleRouteForShare(state.route, 300);
      const payload = {
        ownerUid: uid,
        destLabel: (state.route.destForReroute && state.route.destForReroute.label) || 'Destination',
        legLabel: state.currentLegLabel || null,
        startedAt: firebase.firestore.FieldValue.serverTimestamp(),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        active: true,
        routeCoords,
        totalMiles: state.route.totalDist,
        lastLocation: state.loc ? { lat: state.loc.lat, lon: state.loc.lon, heading: state.loc.heading, speed: state.loc.speed, elevationFt: currentElevationFt(), updatedAt: Date.now() } : null,
      };
      // Part of a multi-day trip plan (see calculateTripPlan()) — include
      // the whole plan so a watcher sees every day's route and overnight
      // stop from the moment they open the link, not just today's.
      // itineraryLegs/itineraryFullRouteCoords/currentLegIndex are the only
      // new fields; routeCoords above still means exactly what it always
      // has (today's leg only), so a plain single-leg trip (state.itinerary
      // null, the common case) writes nothing different from before this
      // feature existed, and older shared trips with no itinerary field
      // render on a watcher's screen exactly as they always have.
      if (state.itinerary) {
        payload.itineraryLegs = state.itinerary.legs.map((l) => ({ label: l.label || null, destLabel: l.destLabel, lat: l.destLat, lon: l.destLon }));
        payload.itineraryFullRouteCoords = buildItineraryOverviewCoords(state.itinerary);
        payload.currentLegIndex = state.itinerary.currentLegIdx;
      }
      await withTimeout(db.collection('trips').doc(pin).set(payload), FIREBASE_CONNECT_TIMEOUT_MS, "Couldn't connect (saving trip) — check your signal and try again.");

      state.share.active = true;
      state.share.pin = pin;
      state.share.ownerUid = uid;
      state.share.lastPushAt = Date.now();
      state.share.lastPushLoc = state.loc ? { lat: state.loc.lat, lon: state.loc.lon } : null;
      state.share.viewerCount = 0;
      state.share.paused = false;
      state.share.pausedAt = 0;
      state.share.pausedLoc = null;
      rememberOwnTrip(pin, state.currentLegLabel);
      subscribeOwnEvents(pin);
      subscribeViewerCount(pin);
      subscribeViewerMessages(pin);
      persistActiveLeg(); // include this pin in the overnight-resume snapshot
      renderSharePanel();
      renderViewerMessages(); // shows the (empty) panel right away rather than waiting on the first snapshot
      toast('Sharing started — passcode ' + pin, 6000);
      return;
    } catch (e) {
      lastError = e;
      if (attempt <= SHARE_CONNECT_RETRIES) { await sleep(2500); continue; }
    }
  }
  panel.innerHTML = `<span class="muted">Couldn't start sharing after ${SHARE_CONNECT_RETRIES + 1} tries: ${lastError.message}</span>
    <button id="retryStartSharingBtn" class="ghost-btn small" style="margin-top:10px;">Try Again</button>`;
  const retryBtn = document.getElementById('retryStartSharingBtn');
  if (retryBtn) retryBtn.onclick = startSharing;
}

async function stopSharing() {
  const sh = state.share;
  const pin = sh.pin;
  if (sh.unsubEvents) { sh.unsubEvents(); sh.unsubEvents = null; }
  if (sh.unsubViewers) { sh.unsubViewers(); sh.unsubViewers = null; }
  if (sh.unsubMessages) { sh.unsubMessages(); sh.unsubMessages = null; }
  if (pin && state.fb) {
    try {
      await state.fb.db.collection('trips').doc(pin).set(
        { active: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) { /* best effort — stale doc will just show "sharing ended" to viewers */ }
  }
  clearMarkers(state.eventMarkers);
  sh.active = false; sh.pin = null; sh.ownerUid = null; sh.events = [];
  sh.messages = []; sh.messagesLoaded = false;
  sh.lastPushAt = 0; sh.lastPushLoc = null; sh.viewerCount = 0;
  sh.paused = false; sh.pausedAt = 0; sh.pausedLoc = null;
  persistActiveLeg(); // drop the pin from the overnight-resume snapshot, keep the route
  renderSharePanel();
  renderViewerMessages(); // hides the messages panel now that sharing's off
  toast('Sharing stopped.', 3000);
}

// Lets the traveler name (or rename) this trip/leg after sharing has
// already started — e.g. it was left blank at "Calculate Route" time, or
// plans changed mid-drive. Updates the same three places a label typed at
// Calculate Route time would end up: the live Firestore doc (so anyone
// watching sees the new name right away, via renderWatchTrip()), this
// device's own active-leg snapshot (persistActiveLeg(), so tomorrow's
// "Resume Trip" offer keeps it), and "My past trip logs" (renameOwnTrip(),
// so that list matches too) — all from one place, so the three can't drift
// out of sync with each other the way a purely local rename would.
function updateTripLabel() {
  const sh = state.share;
  if (!sh.active) return;
  const name = window.prompt('Name for this trip (shown to you and to anyone watching):', state.currentLegLabel || '');
  if (name === null) return; // cancelled
  const label = name.trim();
  state.currentLegLabel = label || null;
  persistActiveLeg();
  renameOwnTrip(sh.pin, label);
  state.fb.db.collection('trips').doc(sh.pin).set(
    { legLabel: state.currentLegLabel, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  ).catch(() => { /* best effort; a stale name for watchers is a minor cosmetic miss */ });
  renderSharePanel();
  toast(label ? 'Trip name updated.' : 'Trip name cleared.', 3000);
}

// Marks the trip as "taking a break" for anyone watching — see
// renderWatchTrip() for how viewers see this — without actually stopping
// sharing (the passcode/link keeps working, no need to send a new one).
// Also remembers where you were so a bit of driving in the morning can
// clear this automatically — see the auto-resume check in
// onLocationUpdate().
function pauseSharingForNight() {
  const sh = state.share;
  if (!sh.active) return;
  sh.paused = true;
  sh.pausedAt = Date.now();
  sh.pausedLoc = state.loc ? { lat: state.loc.lat, lon: state.loc.lon } : null;
  state.fb.db.collection('trips').doc(sh.pin).set(
    { paused: true, pausedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  ).catch(() => { /* best effort; a stale "actively driving" status is a minor cosmetic miss */ });
  renderSharePanel();
  toast("Paused — family will see you're taking a break. Tap Resume (or just start driving again) when you're back on the road.", 6000);
}

function resumeSharingFromPause(auto) {
  const sh = state.share;
  if (!sh.active) return;
  sh.paused = false;
  sh.pausedAt = 0;
  sh.pausedLoc = null;
  state.fb.db.collection('trips').doc(sh.pin).set(
    { paused: false, pausedAt: null, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
    { merge: true }
  ).catch(() => { /* best effort */ });
  renderSharePanel();
  toast(auto ? "Looks like you're moving again — sharing resumed." : 'Sharing resumed.', 4000);
}

function maybePushShareLocation() {
  const sh = state.share;
  if (!sh.active || !state.fb || !state.loc) return;
  const now = Date.now();
  const movedFar = !sh.lastPushLoc || haversineMiles(sh.lastPushLoc.lat, sh.lastPushLoc.lon, state.loc.lat, state.loc.lon) > 0.02;
  // routeDirty (set by performReroute() after a successful reroute) forces
  // a push right now regardless of the usual throttle, and rides along on
  // this same write rather than needing its own separate one — see below.
  if (now - sh.lastPushAt < 15000 && !movedFar && !sh.routeDirty) return;
  sh.lastPushAt = now;
  sh.lastPushLoc = { lat: state.loc.lat, lon: state.loc.lon };
  const payload = {
    lastLocation: { lat: state.loc.lat, lon: state.loc.lon, heading: state.loc.heading, speed: state.loc.speed, elevationFt: currentElevationFt(), updatedAt: now },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };
  // If the route was just recalculated (a reroute), send the fresh polyline
  // along too — otherwise anyone watching would keep seeing the *old* route
  // line on their map forever after this, and their tap-for-ETA estimates
  // (which snap to this same shared data) would drift further off the
  // longer they went without it. routeUpdatedAt lets the viewer cheaply
  // tell "did the route actually change" apart from an ordinary location
  // ping, without diffing 300 points — see renderWatchTrip().
  const pushingRoute = sh.routeDirty && state.route;
  if (pushingRoute) {
    payload.routeCoords = sampleRouteForShare(state.route, 300);
    payload.totalMiles = state.route.totalDist;
    payload.routeUpdatedAt = firebase.firestore.FieldValue.serverTimestamp();
  }
  state.fb.db.collection('trips').doc(sh.pin).set(payload, { merge: true })
    .then(() => { if (pushingRoute) sh.routeDirty = false; })
    .catch(() => { /* best effort; next cycle retries — routeDirty (if set) stays set, so a route push keeps getting retried too */ });
}

// Lets the traveler alone see how many people are actively watching their
// shared trip right now — never shown to viewers themselves. This works
// because Firestore's security rules (see README section 7b) only allow
// the trip's owner to read this "viewers" presence subcollection at all;
// each viewer can only write their own single presence doc, not read
// anyone else's, so there's no way for a viewer to see this count even by
// inspecting network traffic in their own browser.
function subscribeViewerCount(pin) {
  const sh = state.share;
  if (sh.unsubViewers) { sh.unsubViewers(); sh.unsubViewers = null; }
  sh.unsubViewers = state.fb.db.collection('trips').doc(pin).collection('viewers')
    .onSnapshot((snap) => {
      const now = Date.now();
      let count = 0;
      snap.forEach((doc) => {
        const d = doc.data();
        // A presence doc just written with serverTimestamp() can briefly
        // read back with no resolved timestamp yet (pending server ack) —
        // treat that as "just now" rather than undercounting it.
        const seenAt = (d.lastSeenAt && typeof d.lastSeenAt.toMillis === 'function') ? d.lastSeenAt.toMillis() : now;
        if (now - seenAt < 90 * 1000) count++;
      });
      sh.viewerCount = count;
      // Update just the badge's text in place rather than calling
      // renderSharePanel() — that rebuilds the panel's entire innerHTML,
      // which would wipe out (and drop focus from) anything you're in the
      // middle of typing in the comment/video-link box every time this
      // fires (roughly every 30s per active viewer).
      const badge = document.getElementById('viewerCountBadge');
      if (badge) badge.textContent = `👀 ${sh.viewerCount} watching now`;
    }, () => { /* best effort — leave last known count showing */ });
}

// Caps how many photos/videos/comments/auto-generated markers this live
// listener holds and re-renders at once. Without this, a long day (or a
// multi-day Trip Plan) could accumulate dozens of events — several of them
// full-size photos, each up to ~700KB of base64 text — and every single
// new one triggered a full re-render of every past one, on both the
// driver's own screen and every viewer's. That unbounded growth, sitting
// in memory for the entire drive, is what led to a phone's browser tab
// running out of memory and crashing after several hours of sharing (most
// likely to show up as a crash on an unrelated action, like zooming the
// map, since that's just whatever finally needed the last bit of memory).
// Nothing is deleted from Firestore — this only limits what's held/shown
// live in the auto-updating Trip Log; the full history is always still
// there under the same passcode/link.
const EVENTS_LIVE_LIMIT = 40;

function subscribeOwnEvents(pin) {
  if (state.share.unsubEvents) state.share.unsubEvents();
  state.share.unsubEvents = state.fb.db.collection('trips').doc(pin).collection('events')
    .orderBy('createdAt', 'desc')
    .limit(EVENTS_LIVE_LIMIT)
    .onSnapshot((snap) => {
      const events = [];
      snap.forEach((doc) => events.push({ id: doc.id, ...doc.data() }));
      state.share.events = events;
      renderSharePanel();
      renderOwnEventMarkers(events);
    }, (e) => toast('Trip log sync error: ' + e.message, 5000));
}

// Messages family sends FROM the watch screen TO the driver — see
// sendViewerMessage() for the other end. Rendered in a panel right below
// the driver's map (renderViewerMessages()) and, for a genuinely new
// message, read aloud (announceViewerMessage()).
//
// A Firestore listener's very first callback always reports every existing
// document as "added" — there's no way to distinguish "this just arrived"
// from "this already existed" on that first call alone. sh.messagesLoaded
// tracks whether we've been through that first callback yet, so messages
// already sitting there when you start/resume sharing (e.g. overnight,
// while paused) get shown silently instead of read aloud all at once.
function subscribeViewerMessages(pin) {
  const sh = state.share;
  if (sh.unsubMessages) { sh.unsubMessages(); sh.unsubMessages = null; }
  sh.messages = [];
  sh.messagesLoaded = false;
  sh.unsubMessages = state.fb.db.collection('trips').doc(pin).collection('messages')
    .orderBy('createdAt', 'asc')
    .onSnapshot((snap) => {
      const wasAlreadyLoaded = sh.messagesLoaded;
      sh.messagesLoaded = true;
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        const msg = {
          id: change.doc.id,
          text: d.text || '',
          senderName: d.senderName || 'Family',
          senderUid: d.senderUid || null, // who to target if you tap Reply — see startVoiceReply()
          createdAt: (d.createdAt && typeof d.createdAt.toMillis === 'function') ? d.createdAt.toMillis() : Date.now(),
        };
        sh.messages.push(msg);
        if (wasAlreadyLoaded) announceViewerMessage(msg);
      });
      if (snap.docChanges().length) renderViewerMessages();
    }, (e) => toast('Messages sync error: ' + e.message, 8000));
    // ^ surfaced rather than swallowed on purpose: a Firestore listener that
    // errors (e.g. a permissions problem) stops dead and never fires again,
    // so silently ignoring it here would look exactly like "no messages,
    // ever" with no clue why — see README section 4 if this shows up.
}

function renderViewerMessages() {
  const panel = document.getElementById('viewerMessagesPanel');
  const list = document.getElementById('viewerMessagesList');
  if (!panel || !list) return;
  if (!state.share.active) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  // Sticks around until the next reply replaces it (see sendDriverReply())
  // rather than a toast that's gone in a few seconds — enough time to
  // actually check the transcription made sense whenever's convenient.
  const lr = state.share.lastReplySent;
  const lastReplyHtml = lr
    ? `<div class="viewer-message viewer-reply-sent">
        <div class="viewer-message-meta">✅ You replied to ${escapeHtml(lr.toName)} · ${new Date(lr.sentAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
        <div class="viewer-message-text">${escapeHtml(lr.text)}</div>
      </div>`
    : '';
  const msgs = state.share.messages;
  const msgsHtml = msgs.length
    ? msgs.slice().reverse().slice(0, 30).map((m) => {
        const when = new Date(m.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const replyBtn = m.senderUid
          ? `<button class="reply-btn" data-uid="${escapeHtml(m.senderUid)}" data-name="${escapeHtml(m.senderName)}">🎤 Reply</button>`
          : ''; // older messages sent before senderUid was recorded have no one to target
        return `<div class="viewer-message">
          <div class="viewer-message-meta"><b>${escapeHtml(m.senderName)}</b> · ${when}</div>
          <div class="viewer-message-text">${escapeHtml(m.text)}</div>
          ${replyBtn}
        </div>`;
      }).join('')
    : '<div class="muted viewer-message-empty">No messages yet.</div>';
  list.innerHTML = lastReplyHtml + msgsHtml;
}

// Reads an incoming message aloud — but speak() always cancels whatever's
// currently playing before starting a new utterance (see speak()'s own
// comment), so speaking a message the instant it arrives could cut off an
// in-progress turn-by-turn instruction mid-sentence. Rather than risk that,
// check whether speech is already playing first; if so, wait a moment and
// check again (a turn announcement is a few seconds at most), and only give
// up on voice for this one — it's still sitting in the panel to read — if
// it's still busy after a few tries.
function announceViewerMessage(msg, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 4;
  if (!voiceSupported() || !state.settings.voiceEnabled) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (attemptsLeft > 0) setTimeout(() => announceViewerMessage(msg, attemptsLeft - 1), 1500);
    return;
  }
  speak(`Message from ${msg.senderName}: ${msg.text}`);
}

/* ============================== VOICE REPLY (driver → one viewer) ============================== */
// The 🎤 Reply button on each message in the Messages from Family panel —
// tap it, speak, and it goes straight to that one sender (not everyone
// watching). Deliberately hands-free end to end: no text box to type into
// or accidentally wipe by re-rendering mid-keystroke (the same class of bug
// fixed earlier for the Share panel's comment box — see
// captureShareInputState()) — there's simply nothing typed to lose, since
// the whole flow is tap → speak → sent, with a spoken confirmation so you
// don't need to look at the screen to know it went through.
//
// Uses the browser's built-in SpeechRecognition — free, no server, same
// zero-cost philosophy as everything else here — but support and
// reliability vary a lot by browser. Chrome (Android or desktop) is solid;
// Safari's support has historically been inconsistent and can need a
// network connection to actually transcribe, which may not always be
// there on the road. Where it's not available at all, this falls back to
// a quick one-line text prompt instead, so there's always *some* way to
// reply.

function speechRecognitionSupported() {
  return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

let activeVoiceReplyRecognition = null; // only one reply capture in flight at a time

function startVoiceReply(toUid, toName) {
  if (!toUid) { toast("Can't tell who to reply to from that message.", 4000); return; }
  const name = toName || 'Family';

  if (!speechRecognitionSupported()) {
    const text = (window.prompt(`Reply to ${name}:`) || '').trim();
    if (text) sendDriverReply(toUid, name, text);
    return;
  }

  if (activeVoiceReplyRecognition) {
    try { activeVoiceReplyRecognition.stop(); } catch (e) { /* ignore */ }
  }
  const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  const rec = new SpeechRecognitionCtor();
  rec.lang = (navigator.language || 'en-US');
  rec.interimResults = false;
  rec.maxAlternatives = 1;
  activeVoiceReplyRecognition = rec;
  showListeningIndicator(name);

  rec.onresult = (e) => {
    const text = (e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript || '').trim();
    if (text) sendDriverReply(toUid, name, text);
    else toast("Didn't catch that — try the 🎤 Reply button again.", 4000);
  };
  rec.onerror = (e) => {
    const reason = e.error === 'not-allowed' ? 'microphone access is blocked — check your browser/site permissions'
      : e.error === 'no-speech' ? "didn't hear anything — try again"
      : e.error || 'unknown error';
    toast('Voice reply: ' + reason, 5000);
  };
  rec.onend = () => { hideListeningIndicator(); activeVoiceReplyRecognition = null; };

  try { rec.start(); } catch (e) {
    toast("Couldn't start listening: " + e.message, 4000);
    hideListeningIndicator();
    activeVoiceReplyRecognition = null;
  }
}

function showListeningIndicator(name) {
  hideListeningIndicator();
  const div = document.createElement('div');
  div.id = 'voiceReplyIndicator';
  div.className = 'listening-indicator';
  div.innerHTML = `🎙 Listening — reply to ${escapeHtml(name)}…`;
  document.body.appendChild(div);
}
function hideListeningIndicator() {
  const div = document.getElementById('voiceReplyIndicator');
  if (div) div.remove();
}

async function sendDriverReply(toUid, toName, text) {
  if (!state.share.active || !state.share.pin || !state.fb) { toast('Not sharing right now.', 3000); return; }
  try {
    await state.fb.db.collection('trips').doc(state.share.pin).collection('replies').add({
      text: text.slice(0, 300),
      toUid,
      toName: toName || 'Family',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    speak(`Reply sent to ${toName}.`); // audible confirmation — no need to glance at the screen
    toast(`Reply sent to ${toName}: "${text}"`, 5000);
    // Also shown persistently in the Messages from Family panel (see
    // renderViewerMessages()) — the toast alone disappears in a few
    // seconds, not always enough time to actually glance over and check
    // the transcription made sense while driving. This sticks around
    // until the next reply replaces it, so it can be checked whenever's
    // convenient instead of needing to catch it in that narrow window.
    state.share.lastReplySent = { toName: toName || 'Family', text, sentAt: Date.now() };
    renderViewerMessages();
  } catch (e) {
    toast("Couldn't send reply: " + friendlySendErrorMessage(e), 6000);
  }
}

function wireViewerMessageReplies() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.reply-btn');
    if (!btn) return;
    startVoiceReply(btn.dataset.uid, btn.dataset.name);
  });
}

// Loads an image file into an <img> via a blob URL so it can be drawn to a
// canvas for resizing/compression.
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read that image file.'));
    img.src = url;
  });
}

// Shrinks/re-compresses the photo until its base64 text comfortably fits in
// a single Firestore document (1MB hard limit) alongside its other fields —
// this is what lets photos skip Firebase Storage (and its billing
// requirement) entirely. Most phone photos need one or two passes.
async function compressImageForFirestore(file) {
  const img = await loadImageFromFile(file);
  const budgetChars = 700000; // ~700KB of base64 text, safely under the 1MB/doc cap
  let maxDim = 1600;
  let quality = 0.7;
  try {
    for (let attempt = 0; attempt < 7; attempt++) {
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      const base64 = dataUrl.split(',')[1];
      const atFloor = maxDim <= 480 && quality <= 0.35;
      if (base64.length <= budgetChars || atFloor) {
        return { base64, mediaType: 'image/jpeg' };
      }
      quality = Math.max(0.35, quality - 0.12);
      maxDim = Math.round(maxDim * 0.8);
    }
    throw new Error('Photo is too large to fit even after compression.');
  } finally {
    URL.revokeObjectURL(img.src);
  }
}

async function addPhoto(file) {
  const sh = state.share;
  if (!sh.active) { toast('Start sharing first to attach photos to your trip.', 5000); return; }
  if (!state.loc) { toast('Waiting for GPS before tagging a location.', 4000); return; }
  if (!file.type.startsWith('image/')) { toast("Please choose a photo — video isn't supported (it needs paid Firebase Storage; photos don't).", 7000); return; }
  toast('Adding photo…', 8000);
  try {
    const { base64, mediaType } = await compressImageForFirestore(file);
    const expiresAt = new Date(Date.now() + MEDIA_TTL_DAYS * 24 * 60 * 60 * 1000);
    await state.fb.db.collection('trips').doc(sh.pin).collection('events').add({
      type: 'photo',
      mediaData: base64,
      mediaType,
      lat: state.loc.lat, lon: state.loc.lon,
      elevationFt: currentElevationFt(),
      tempF: state.cache.currentTempF, tempUnit: state.cache.currentTempUnit,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      expiresAt, // read by cleanupExpiredMedia() below to auto-delete this doc ~90 days out
    });
    toast('Photo added to your trip.', 4000);
  } catch (e) {
    toast("Couldn't add photo: " + e.message, 6000);
  }
}

// Stands in for a server-side TTL policy (Google Cloud Console's TTL setup
// needs a permission level this Google account doesn't have — see README
// section 7d). Runs at most once a day, from whichever phone has ever
// started sharing a trip: looks back through this phone's own past trips
// (see rememberOwnTrip()) and deletes any photo whose expiresAt has passed.
// Comments and video links are left alone (they're tiny, not "large
// media"), and a trip's route/label/passcode document is never touched —
// only individual expired photo documents inside it.
async function cleanupExpiredMedia() {
  if (!firebaseConfigured()) return;
  const last = Number(localStorage.getItem(LS_LAST_MEDIA_CLEANUP) || 0);
  const now = Date.now();
  if (now - last < MEDIA_CLEANUP_MIN_INTERVAL_MS) return;
  try {
    const { db } = await initFirebase();
    const trips = loadOwnTrips();
    for (const t of trips) {
      try {
        const snap = await db.collection('trips').doc(t.pin).collection('events')
          .where('type', '==', 'photo').get();
        const deletions = [];
        snap.forEach((doc) => {
          const exp = doc.data().expiresAt;
          const expMs = exp && typeof exp.toMillis === 'function' ? exp.toMillis() : null;
          if (expMs && expMs <= now) deletions.push(doc.ref.delete());
        });
        if (deletions.length) await Promise.all(deletions);
      } catch (e) {
        // Best effort, one trip at a time — an old/already-cleared trip
        // shouldn't stop the rest of the list from being checked.
      }
    }
    localStorage.setItem(LS_LAST_MEDIA_CLEANUP, String(now));
  } catch (e) {
    // Best effort — cleanup never interrupts normal use of the app.
  }
}

// Pulls the file ID out of a Google Drive share link so a thumbnail can be
// shown (Drive serves public thumbnails for files shared "Anyone with the
// link"). Returns null for anything that doesn't look like a Drive link —
// the raw link is still saved and openable either way.
function extractDriveFileId(url) {
  let m = url.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  m = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (m) return m[1];
  return null;
}

async function addVideoLink(url) {
  const sh = state.share;
  if (!sh.active) { toast('Start sharing first to add a video link to your trip.', 5000); return; }
  const trimmed = (url || '').trim();
  if (!/^https?:\/\//i.test(trimmed)) { toast('That doesn\'t look like a web link — paste the "Anyone with the link" URL from Google Drive.', 6000); return; }
  const loc = state.loc || (state.route ? { lat: state.route.coords[0][1], lon: state.route.coords[0][0] } : null);
  try {
    await state.fb.db.collection('trips').doc(sh.pin).collection('events').add({
      type: 'video',
      url: trimmed,
      driveFileId: extractDriveFileId(trimmed),
      lat: loc ? loc.lat : null, lon: loc ? loc.lon : null,
      elevationFt: currentElevationFt(),
      tempF: state.cache.currentTempF, tempUnit: state.cache.currentTempUnit,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Video link added to your trip.', 4000);
  } catch (e) {
    toast("Couldn't add video link: " + e.message, 6000);
  }
}

async function addComment(text) {
  const sh = state.share;
  if (!sh.active) { toast('Start sharing first to add comments to your trip.', 5000); return; }
  if (!text || !text.trim()) return;
  const loc = state.loc || (state.route ? { lat: state.route.coords[0][1], lon: state.route.coords[0][0] } : null);
  try {
    await state.fb.db.collection('trips').doc(sh.pin).collection('events').add({
      type: 'comment',
      text: text.trim().slice(0, 500),
      lat: loc ? loc.lat : null, lon: loc ? loc.lon : null,
      elevationFt: currentElevationFt(),
      tempF: state.cache.currentTempF, tempUnit: state.cache.currentTempUnit,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Comment added.', 3000);
  } catch (e) {
    toast("Couldn't add comment: " + e.message, 5000);
  }
}

/* ============================== US STATE CROSSINGS ============================== */
// Automatically drops a "you crossed into a new state" trivia comment about
// a mile after the driver's GPS enters a new US state — visible in the trip
// log to the driver and every watcher exactly like a hand-typed comment
// (same Firestore "events" collection, same map pins), plus spoken aloud
// once any in-progress turn announcement has finished. Boundary polygons +
// facts (capital/bird/tree/flower/nickname/statehood/population/current
// government control) live in assets/us-states-data.js
// (window.US_STATES_DATA), loaded before this file so it's ready offline
// the moment GPS starts — no extra network round-trip mid-drive.
const US_STATE_CROSS_MILES = 1; // how far past the line before announcing

// Standard ray-casting point-in-ring test (works for both outer boundaries
// and holes — pointInPolygons() below decides which is which).
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) &&
      (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}
// polygons: array of polygons; each polygon is an array of rings where
// ring 0 is the outer boundary and any further rings are holes cut out of
// it (standard GeoJSON MultiPolygon shape) — matters for a handful of
// states with detached islands/holes near the coast.
function pointInPolygons(lon, lat, polygons) {
  for (const poly of polygons) {
    if (!poly.length || !pointInRing(lon, lat, poly[0])) continue;
    let inHole = false;
    for (let h = 1; h < poly.length; h++) {
      if (pointInRing(lon, lat, poly[h])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}
// Bounding-box reject first (cheap) before the real point-in-polygon test —
// keeps this affordable to run on every single GPS fix.
function findStateForPoint(lat, lon) {
  const list = window.US_STATES_DATA;
  if (!list) return null;
  for (const st of list) {
    const b = st.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (pointInPolygons(lon, lat, st.polygons)) return st;
  }
  return null;
}

function humanizePopulation(n) {
  if (typeof n !== 'number') return 'unknown';
  if (n >= 1000000) return `about ${(n / 1000000).toFixed(1)} million`;
  return `about ${(Math.round(n / 1000) * 1000).toLocaleString()}`;
}

// One line for the on-screen comment text and the map-pin popup — reads
// straight off the Firestore fields written by addStateCrossingComment()
// below, so the trip-log display always matches exactly what got saved.
function stateEventFactsLine(ev) {
  return `${ev.stateName} (${ev.nickname}) · Capital: ${ev.capital} · `
    + `Population: ${ev.population.toLocaleString()} · Bird: ${ev.bird} · `
    + `Tree: ${ev.tree} · Flower: ${ev.flower} · Admitted to the Union: ${ev.statehood} · `
    + `GDP: $${ev.gdpBillions.toLocaleString()}B (${ev.gdpPctOfUS}% of U.S. GDP) · `
    + `Government: ${ev.control}`;
}
// Spoken version, built from the freshly detected state object (see
// findStateForPoint()) at the moment of crossing.
function stateFactsSpoken(st) {
  return `Just entered ${st.name}, the ${st.nickname}, admitted to the Union ${st.statehood}. `
    + `Its capital is ${st.capital}, population ${humanizePopulation(st.population)}. `
    + `The state bird is the ${st.bird}, the state tree is the ${st.tree}, `
    + `and the state flower is the ${st.flower}. `
    + `${st.name} generates about ${st.gdpPctOfUS} percent of U.S. GDP. `
    + `${st.name} currently has ${/^[aeiou]/i.test(st.control) ? 'an' : 'a'} ${st.control.replace(/ \(.*/, '')}.`;
}

// Same defer-and-retry pattern as announceViewerMessage() — never cut off
// an in-progress turn instruction; give up on voice (but not the comment
// itself, which is still in the trip log either way) after a few tries.
function announceStateCrossing(st, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 6; // a bit more patient than messages — this fires rarely
  if (!voiceSupported() || !state.settings.voiceEnabled) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (attemptsLeft > 0) setTimeout(() => announceStateCrossing(st, attemptsLeft - 1), 1500);
    return;
  }
  speak(stateFactsSpoken(st));
}

async function addStateCrossingComment(st) {
  const sh = state.share;
  if (!sh.active) return; // nothing to attach it to — see checkUSStateCrossing()
  const loc = state.loc;
  try {
    await state.fb.db.collection('trips').doc(sh.pin).collection('events').add({
      type: 'state',
      stateName: st.name,
      stateAbbr: st.abbr,
      capital: st.capital,
      population: st.population,
      bird: st.bird,
      tree: st.tree,
      flower: st.flower,
      nickname: st.nickname,
      statehood: st.statehood,
      gdpBillions: st.gdpBillions,
      gdpPctOfUS: st.gdpPctOfUS,
      control: st.control,
      lat: loc ? loc.lat : null, lon: loc ? loc.lon : null,
      elevationFt: currentElevationFt(),
      tempF: state.cache.currentTempF, tempUnit: state.cache.currentTempUnit,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Best-effort — a missed system comment shouldn't interrupt the drive
    // with an error toast the way a failed manual comment would.
  }
}

// Persists the three "confirmed" crossing-trackers (state/city/time zone)
// across a full page reload. Each one normally starts fresh at page load
// and silently adopts wherever you currently are as your starting point
// (see the "adopt it silently" comments below and in
// checkUSCityCrossing()/checkUSTimezoneCrossing()) — exactly right for the
// common case of just reopening the app. But a reload can also happen
// mid-drive with no warning: most commonly, taking a photo through the
// phone's camera (the file input with capture="environment" in index.html)
// backgrounds this tab, and some phones reclaim a backgrounded tab's memory
// and silently reload it the moment you switch back. If that happens to
// land right as you cross a state/city/time-zone line, a fresh session
// would otherwise adopt the new one as if you'd started there, with no
// announcement or trip-log entry for the crossing that actually just
// happened. Saving each tracker's last confirmed value here, and restoring
// it in resumeActiveLeg() before that fresh session's first GPS fix is
// processed, means the normal mile-buffer confirmation logic picks the
// crossing back up and still announces it once you've driven a bit
// further, instead of it going missing entirely.
const GEO_TRACK_STORAGE_KEY = 'rtn_geoTrack';

function saveConfirmedGeoTracking() {
  try {
    localStorage.setItem(GEO_TRACK_STORAGE_KEY, JSON.stringify({
      state: state.usStateTrack.confirmed || null,
      cityInitialized: state.usCityTrack.initialized,
      city: state.usCityTrack.confirmed || null,
      tzId: state.tzTrack.confirmed ? state.tzTrack.confirmed.ianaId : null,
    }));
  } catch (e) {
    // Best-effort — private browsing or a full storage quota shouldn't
    // interrupt anything else.
  }
}

// Called once from resumeActiveLeg(), before its first onLocationUpdate().
function restoreConfirmedGeoTracking() {
  try {
    const raw = localStorage.getItem(GEO_TRACK_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (saved.state) {
      state.usStateTrack.confirmed = saved.state;
      state.usStateTrack.candidate = null; state.usStateTrack.candidateMiles = 0; state.usStateTrack.lastLoc = null;
    }
    if (saved.cityInitialized) {
      state.usCityTrack.initialized = true;
      state.usCityTrack.confirmed = saved.city || null;
      state.usCityTrack.candidate = null; state.usCityTrack.candidateMiles = 0; state.usCityTrack.lastLoc = null;
    }
    if (saved.tzId && window.US_TIMEZONES_DATA) {
      const tz = window.US_TIMEZONES_DATA.find((z) => z.ianaId === saved.tzId);
      if (tz) {
        state.tzTrack.confirmed = tz;
        state.tzTrack.candidate = null; state.tzTrack.candidateMiles = 0; state.tzTrack.lastLoc = null;
      }
    }
  } catch (e) {
    // Best-effort — a corrupt/unreadable saved value just leaves the
    // trackers at their normal fresh-session defaults.
  }
}

// Called from onLocationUpdate() on every GPS fix while a route is active.
// Requires being confirmed inside the new state for US_STATE_CROSS_MILES of
// actual travel (not just one fix past the line) before announcing, so a
// route that briefly clips a corner of a neighboring state, or ordinary GPS
// jitter right at the border, doesn't fire a false announcement.
function checkUSStateCrossing(loc) {
  if (!window.US_STATES_DATA || !loc) return;
  const track = state.usStateTrack;
  const detected = findStateForPoint(loc.lat, loc.lon);
  if (!detected) return; // between polygons (simplification gap) or no fix yet — leave tracking as-is

  if (track.confirmed === null) {
    // First state we can determine this page session — the one you're
    // starting in. Adopt it silently; you already know where you are.
    track.confirmed = detected.name;
    track.candidate = null; track.candidateMiles = 0; track.lastLoc = loc;
    saveConfirmedGeoTracking();
    return;
  }
  if (detected.name === track.confirmed) {
    track.candidate = null; track.candidateMiles = 0; track.lastLoc = loc;
    return;
  }
  if (track.candidate !== detected.name) {
    track.candidate = detected.name;
    track.candidateMiles = 0;
  } else if (track.lastLoc) {
    track.candidateMiles += haversineMiles(track.lastLoc.lat, track.lastLoc.lon, loc.lat, loc.lon);
  }
  track.lastLoc = loc;
  if (track.candidateMiles >= US_STATE_CROSS_MILES) {
    track.confirmed = detected.name;
    track.candidate = null;
    track.candidateMiles = 0;
    saveConfirmedGeoTracking();
    if (state.share.active) {
      addStateCrossingComment(detected);
      announceStateCrossing(detected);
    }
  }
}

/* ============================== US CITY CROSSINGS ============================== */
// Same idea as the state-crossing comment above, but for entering one of
// ~85 major, non-suburb US cities — city name, population, incorporation
// year, primary industry, and current mayor/party. Facts + a simple
// center-point-and-radius "geofence" (not a real municipal boundary — see
// assets/us-cities-data.js) live in window.US_CITIES_DATA, loaded before
// this file. Suburbs of a bigger neighboring city (Mesa/Tempe/Scottsdale
// near Phoenix, Henderson near Las Vegas, etc.) are simply left out of the
// dataset entirely, so driving through one triggers nothing — only the
// metro's own principal city is ever announced.
const US_CITY_CONFIRM_MILES = 0.2; // small stability buffer, not a deliberate "wait a mile" design like states

// Picks the best-matching city circle a point falls inside, preferring the
// one it's proportionally deepest into (distance/radius ratio) in the rare
// case two cities' circles overlap (e.g. Tampa/St. Petersburg across the
// bay) rather than always taking whichever happens to come first in the list.
function findCityForPoint(lat, lon) {
  const list = window.US_CITIES_DATA;
  if (!list) return null;
  let best = null, bestRatio = Infinity;
  for (const c of list) {
    const d = haversineMiles(lat, lon, c.lat, c.lon);
    if (d > c.radiusMiles) continue;
    const ratio = d / c.radiusMiles;
    if (ratio < bestRatio) { bestRatio = ratio; best = c; }
  }
  return best;
}

// One line for the on-screen comment text and the map-pin popup — reads
// straight off the Firestore fields written by addCityCrossingComment().
function cityEventFactsLine(ev) {
  return `${ev.cityName}, ${ev.stateAbbr} · Population: ${ev.population.toLocaleString()} · `
    + `Incorporated: ${ev.incorporated} · Primary industry: ${ev.industry} · `
    + `Mayor: ${ev.mayor} (${ev.party})`;
}
function cityFactsSpoken(c) {
  const partyBit = /nonpartisan/i.test(c.party)
    ? `an officially nonpartisan mayor's office, currently held by ${c.mayor}`
    : `a mayor from the ${c.party} party, ${c.mayor}`;
  return `Just entered ${c.name}, ${c.stateName}. Population ${humanizePopulation(c.population)}, `
    + `incorporated in ${c.incorporated}. Its primary industry is ${c.industry}. `
    + `${c.name} has ${partyBit}.`;
}

// Same defer-and-retry pattern used for state crossings and viewer messages
// — never talk over an in-progress turn instruction.
function announceCityCrossing(c, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 6;
  if (!voiceSupported() || !state.settings.voiceEnabled) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (attemptsLeft > 0) setTimeout(() => announceCityCrossing(c, attemptsLeft - 1), 1500);
    return;
  }
  speak(cityFactsSpoken(c));
}

async function addCityCrossingComment(c) {
  const sh = state.share;
  if (!sh.active) return;
  const loc = state.loc;
  try {
    await state.fb.db.collection('trips').doc(sh.pin).collection('events').add({
      type: 'city',
      cityName: c.name,
      stateAbbr: c.state,
      stateName: c.stateName,
      population: c.population,
      incorporated: c.incorporated,
      industry: c.industry,
      mayor: c.mayor,
      party: c.party,
      lat: loc ? loc.lat : null, lon: loc ? loc.lon : null,
      elevationFt: currentElevationFt(),
      tempF: state.cache.currentTempF, tempUnit: state.cache.currentTempUnit,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Best-effort, same as addStateCrossingComment().
  }
}

// Called from onLocationUpdate() alongside checkUSStateCrossing(). A city
// circle is usually much smaller than a state, so this only asks for a
// short confirmed distance inside it (US_CITY_CONFIRM_MILES) before
// announcing — just enough to shrug off GPS jitter right at the edge, not
// a deliberate "wait before telling you" design like the state feature's
// full mile.
function checkUSCityCrossing(loc) {
  if (!window.US_CITIES_DATA || !loc) return;
  const track = state.usCityTrack;
  const detected = findCityForPoint(loc.lat, loc.lon);
  const detectedName = detected ? detected.name : null;

  if (!track.initialized) {
    // First fix ever this page session — silently adopt wherever you
    // happen to be, whether that's inside a tracked city's circle or not.
    // No announcement for the city you're starting in/near.
    track.initialized = true;
    track.confirmed = detectedName;
    track.candidate = null; track.candidateMiles = 0; track.lastLoc = loc;
    saveConfirmedGeoTracking();
    return;
  }
  if (detectedName === track.confirmed) {
    track.candidate = null; track.candidateMiles = 0; track.lastLoc = loc;
    return;
  }
  if (track.candidate !== detectedName) {
    track.candidate = detectedName;
    track.candidateMiles = 0;
  } else if (track.lastLoc) {
    track.candidateMiles += haversineMiles(track.lastLoc.lat, track.lastLoc.lon, loc.lat, loc.lon);
  }
  track.lastLoc = loc;
  if (track.candidateMiles >= US_CITY_CONFIRM_MILES) {
    track.confirmed = detectedName;
    track.candidate = null;
    track.candidateMiles = 0;
    saveConfirmedGeoTracking();
    // Only a real, named city firing counts as "entering" — confirming a
    // null (i.e. confirming that you've left the last city) is silent.
    if (detected && state.share.active) {
      addCityCrossingComment(detected);
      announceCityCrossing(detected);
    }
  }
}

/* ============================== US TIME ZONE CROSSINGS ============================== */
// Draws the boundary lines between the practical US time zones on both the
// driver's own map and every watcher's map (see drawTimezoneLines(), called
// once from initMap() and initWatchMap() — the lines are static, so unlike
// the route line they're only ever drawn once, never redrawn), and alerts
// the driver when GPS confirms they've actually moved into a different
// zone. Boundary polygons live in assets/us-timezones-data.js
// (window.US_TIMEZONES_DATA), loaded before this file, same pattern as
// assets/us-states-data.js/us-cities-data.js.
//
// Unlike the state/city crossing trivia above, this alert is useful
// information for the driver whether or not they happen to be sharing a
// trip right now (their clock is about to change either way), so — unlike
// addStateCrossingComment()/addCityCrossingComment() — the toast + spoken
// alert below fire regardless of state.share.active. Only the Firestore
// trip-log entry (so watchers see it too) is naturally limited to an
// active share, same as everything else in the trip log.
const US_TZ_CROSS_MILES = 1; // same confirm buffer as state crossings — see checkUSStateCrossing()

// Bounding-box reject first (cheap), same pattern as findStateForPoint().
function findTimezoneForPoint(lat, lon) {
  const list = window.US_TIMEZONES_DATA;
  if (!list) return null;
  for (const tz of list) {
    const b = tz.bbox;
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue;
    if (pointInPolygons(lon, lat, tz.polygons)) return tz;
  }
  return null;
}

// The real current UTC offset (in minutes, e.g. -420 for GMT-7) for a given
// IANA zone id, computed live via the browser's own Intl support rather
// than tracked by this app — so it's automatically correct on both sides
// of a Daylight Saving switchover with no DST date-math of our own to get
// wrong. This is what lets the alert below tell the difference between an
// official zone-line crossing that actually changes the clock right now
// and one that doesn't (Arizona's "Mountain (Arizona)" zone keeps the same
// offset as Pacific for the part of the year Pacific observes DST).
function currentUtcOffsetMinutes(ianaId) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: ianaId, timeZoneName: 'shortOffset' }).formatToParts(new Date());
    const tzPart = parts.find((p) => p.type === 'timeZoneName');
    const m = tzPart && tzPart.value.match(/GMT([+-])(\d+)(?::(\d+))?/);
    if (!m) return null;
    const sign = m[1] === '-' ? -1 : 1;
    const hours = parseInt(m[2], 10);
    const mins = m[3] ? parseInt(m[3], 10) : 0;
    return sign * (hours * 60 + mins);
  } catch (e) {
    return null; // unrecognized ianaId, or a browser without Intl timeZoneName support
  }
}

function formatUtcOffset(mins) {
  if (mins === null || mins === undefined) return 'an unknown offset';
  const sign = mins < 0 ? '−' : '+';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

// Builds the alert text shown in the toast and spoken aloud, comparing the
// *actual* current offset of the old and new zone rather than just their
// names — see currentUtcOffsetMinutes() above for why that matters.
function timezoneCrossingText(fromTz, toTz) {
  const fromOffset = fromTz ? currentUtcOffsetMinutes(fromTz.ianaId) : null;
  const toOffset = currentUtcOffsetMinutes(toTz.ianaId);
  const dstNote = toTz.note ? ` ${toTz.note}` : '';
  if (fromOffset !== null && toOffset !== null && fromOffset === toOffset) {
    return `Crossed into the ${toTz.name} time zone — but the clock stays the same for now, both zones are ${formatUtcOffset(toOffset)} right now.${dstNote}`;
  }
  if (fromOffset !== null && toOffset !== null) {
    const diffHours = (toOffset - fromOffset) / 60;
    const dir = diffHours > 0 ? 'ahead' : 'behind';
    const hoursLabel = Math.abs(diffHours) === 1 ? '1 hour' : `${Math.abs(diffHours)} hours`;
    return `Crossed into the ${toTz.name} time zone (${formatUtcOffset(toOffset)}) — clocks here are ${hoursLabel} ${dir}.${dstNote}`;
  }
  return `Crossed into the ${toTz.name} time zone.${dstNote}`;
}

// Same defer-and-retry pattern as announceStateCrossing()/announceCityCrossing()
// — never talk over an in-progress turn instruction.
function announceTimezoneCrossing(text, attemptsLeft) {
  if (attemptsLeft === undefined) attemptsLeft = 6;
  if (!voiceSupported() || !state.settings.voiceEnabled) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
    if (attemptsLeft > 0) setTimeout(() => announceTimezoneCrossing(text, attemptsLeft - 1), 1500);
    return;
  }
  speak(text);
}

async function addTimezoneCrossingComment(toTz, text, fromOffset, toOffset) {
  const sh = state.share;
  if (!sh.active) return; // nothing to attach it to — the toast/speech above already happened either way
  const loc = state.loc;
  try {
    await state.fb.db.collection('trips').doc(sh.pin).collection('events').add({
      type: 'timezone',
      tzName: toTz.name,
      tzAbbr: toTz.abbr,
      ianaId: toTz.ianaId,
      utcOffsetMinutes: toOffset,
      clockChanged: fromOffset !== null && toOffset !== null && fromOffset !== toOffset,
      text,
      lat: loc ? loc.lat : null, lon: loc ? loc.lon : null,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Best-effort, same as addStateCrossingComment().
  }
}

// Called from onLocationUpdate() alongside checkUSStateCrossing()/
// checkUSCityCrossing(). Same confirm-buffer pattern as the state check:
// requires US_TZ_CROSS_MILES of actual travel confirmed inside the new
// zone before alerting, so GPS jitter right at a zone line (which, unlike
// state lines, sometimes runs right down the middle of a small town)
// doesn't fire a false/flapping alert.
function checkUSTimezoneCrossing(loc) {
  if (!window.US_TIMEZONES_DATA || !loc) return;
  const track = state.tzTrack;
  const detected = findTimezoneForPoint(loc.lat, loc.lon);
  if (!detected) return; // between polygons (simplification gap) or no fix yet — leave tracking as-is

  if (track.confirmed === null) {
    // First zone we can determine this page session — the one you're
    // starting in. Adopt it silently; you already know what time it is.
    track.confirmed = detected;
    track.candidate = null; track.candidateMiles = 0; track.lastLoc = loc;
    saveConfirmedGeoTracking();
    return;
  }
  if (detected.name === track.confirmed.name) {
    track.candidate = null; track.candidateMiles = 0; track.lastLoc = loc;
    return;
  }
  if (!track.candidate || track.candidate.name !== detected.name) {
    track.candidate = detected;
    track.candidateMiles = 0;
  } else if (track.lastLoc) {
    track.candidateMiles += haversineMiles(track.lastLoc.lat, track.lastLoc.lon, loc.lat, loc.lon);
  }
  track.lastLoc = loc;
  if (track.candidateMiles >= US_TZ_CROSS_MILES) {
    const fromTz = track.confirmed;
    track.confirmed = detected;
    track.candidate = null;
    track.candidateMiles = 0;
    saveConfirmedGeoTracking();
    const fromOffset = fromTz ? currentUtcOffsetMinutes(fromTz.ianaId) : null;
    const toOffset = currentUtcOffsetMinutes(detected.ianaId);
    const text = timezoneCrossingText(fromTz, detected);
    toast(text, 7000);
    announceTimezoneCrossing(text);
    addTimezoneCrossingComment(detected, text, fromOffset, toOffset);
  }
}

// Draws every zone's boundary as a static, non-interactive dashed outline —
// called once each from initMap() (driver) and initWatchMap() (viewer), and
// never redrawn afterward since these lines never move. Distinct dash
// style from the solid blue route line so the two are never confused, and
// non-interactive/unfilled so they never get in the way of tapping the map
// (see handleMapTapForEta()) or seeing the satellite/street imagery
// underneath. A single permanent label near the middle of each zone's
// largest piece names it, so both the driver and a watcher can tell which
// zone is which side of a given line without needing a separate legend.
function drawTimezoneLines(map) {
  const zones = window.US_TIMEZONES_DATA;
  if (!zones || !map) return;
  zones.forEach((tz) => {
    let largestPoly = null, largestPts = -1;
    tz.polygons.forEach((part) => {
      const latlngs = part.map((ring) => ring.map(([lon, lat]) => [lat, lon]));
      const poly = L.polygon(latlngs, {
        color: tz.color, weight: 2, opacity: 0.6, dashArray: '7 6',
        fill: false, interactive: false,
      }).addTo(map);
      if (part[0].length > largestPts) { largestPts = part[0].length; largestPoly = poly; }
    });
    if (largestPoly) {
      largestPoly.bindTooltip(`${tz.abbr} — ${tz.name}${tz.observesDST ? '' : ' (no DST)'}`, {
        permanent: true, direction: 'center', className: 'tz-tooltip',
      });
    }
  });
}

// Builds the "📍 lat, lon · temp · elevation" bit shown next to the
// timestamp on every comment/photo/video — whatever was known at the
// moment it was added (see addPhoto()/addVideoLink()/addComment()).
// Older events added before this feature won't have tempF/elevationFt on
// their doc yet, so each piece is simply left out rather than shown as
// blank/zero.
function eventMetaLine(ev) {
  const parts = [];
  if (typeof ev.lat === 'number' && typeof ev.lon === 'number') {
    parts.push(`📍 ${ev.lat.toFixed(4)}, ${ev.lon.toFixed(4)}`);
  }
  if (typeof ev.tempF === 'number') {
    parts.push(`${Math.round(ev.tempF)}°${ev.tempUnit || 'F'}`);
  }
  if (typeof ev.elevationFt === 'number') {
    parts.push(`⛰ ${ev.elevationFt.toLocaleString()} ft`);
  }
  return parts.join(' · ');
}

function renderEventItem(ev) {
  const when = (ev.createdAt && ev.createdAt.toDate)
    ? ev.createdAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'just now';
  const meta = eventMetaLine(ev);
  const whenLine = meta ? `${when} · ${meta}` : when;
  if (ev.type === 'comment') {
    return `<div class="event-item"><div class="event-icon">💬</div><div>
      <div class="item-main">${escapeHtml(ev.text || '')}</div>
      <div class="item-sub">${whenLine}</div></div></div>`;
  }
  if (ev.type === 'state') {
    return `<div class="event-item"><div class="event-icon state-event-icon">🤖</div><div>
      <div class="item-main">🏁 Just entered ${escapeHtml(ev.stateName || '')} <span class="muted" style="font-weight:400;font-size:11px;">(system comment)</span></div>
      <div class="item-sub">${escapeHtml(stateEventFactsLine(ev))}</div>
      <div class="item-sub">${whenLine}</div></div></div>`;
  }
  if (ev.type === 'city') {
    return `<div class="event-item"><div class="event-icon city-event-icon">🏙️</div><div>
      <div class="item-main">🏁 Just entered ${escapeHtml(ev.cityName || '')} <span class="muted" style="font-weight:400;font-size:11px;">(system comment)</span></div>
      <div class="item-sub">${escapeHtml(cityEventFactsLine(ev))}</div>
      <div class="item-sub">${whenLine}</div></div></div>`;
  }
  if (ev.type === 'timezone') {
    return `<div class="event-item"><div class="event-icon tz-event-icon">🕐</div><div>
      <div class="item-main">🕐 ${escapeHtml(ev.text || `Just entered the ${ev.tzName || ''} time zone`)} <span class="muted" style="font-weight:400;font-size:11px;">(system comment)</span></div>
      <div class="item-sub">${whenLine}</div></div></div>`;
  }
  if (ev.type === 'video') {
    const thumb = ev.driveFileId
      ? `<img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(ev.driveFileId)}&sz=w200" class="event-thumb" alt="Video thumbnail" loading="lazy" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'event-icon',textContent:'🎥'}))">`
      : `<div class="event-icon">🎥</div>`;
    return `<a class="event-item" href="${escapeHtml(ev.url || '#')}" target="_blank" rel="noopener">${thumb}<div>
      <div class="item-main">🎥 Watch video ↗</div>
      <div class="item-sub">${whenLine}</div></div></a>`;
  }
  const src = `data:${ev.mediaType || 'image/jpeg'};base64,${ev.mediaData}`;
  const filename = `trip-photo-${(ev.createdAt && ev.createdAt.toDate) ? ev.createdAt.toDate().getTime() : Date.now()}.jpg`;
  return `<div class="event-item">
    <img src="${src}" class="event-thumb event-photo-img" alt="Trip photo — tap to enlarge" loading="lazy">
    <div class="event-item-body">
      <div class="item-main">📷 Photo</div>
      <div class="item-sub">${whenLine}</div>
      <div class="event-item-actions">
        <a href="${src}" download="${filename}" class="ghost-btn small">⬇ Save</a>
        <button type="button" class="ghost-btn small share-photo-btn">📤 Share</button>
      </div>
    </div>
  </div>`;
}

function makeEventMarker(ev) {
  const iconEmoji = ev.type === 'comment' ? '💬' : ev.type === 'state' ? '🤖' : ev.type === 'city' ? '🏙️' : ev.type === 'timezone' ? '🕐' : ev.type === 'video' ? '🎥' : '📷';
  const icon = ev.type === 'state'
    ? L.divIcon({
        className: 'event-marker',
        html: `<div class="event-marker-icon state-marker-icon">${iconEmoji}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 27],
      })
    : ev.type === 'city'
    ? L.divIcon({
        className: 'event-marker',
        html: `<div class="event-marker-icon city-marker-icon">${iconEmoji}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 27],
      })
    : ev.type === 'timezone'
    ? L.divIcon({
        className: 'event-marker',
        html: `<div class="event-marker-icon tz-marker-icon">${iconEmoji}</div>`,
        iconSize: [30, 30], iconAnchor: [15, 27],
      })
    : L.divIcon({
        className: 'event-marker',
        html: `<div class="event-marker-icon">${iconEmoji}</div>`,
        iconSize: [26, 26], iconAnchor: [13, 24],
      });
  const when = (ev.createdAt && ev.createdAt.toDate)
    ? ev.createdAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'just now';
  const meta = eventMetaLine(ev);
  const metaLine = `<div style="font-size:11px;opacity:.7;margin-top:4px;">${when}${meta ? ' · ' + meta : ''}</div>`;
  let popupHtml;
  if (ev.type === 'comment') {
    popupHtml = `<b>💬 Comment</b><br>${escapeHtml(ev.text || '')}${metaLine}`;
  } else if (ev.type === 'state') {
    popupHtml = `<b>🤖 Just entered ${escapeHtml(ev.stateName || '')}</b> <span class="muted" style="font-size:11px;">(system comment)</span><br>${escapeHtml(stateEventFactsLine(ev))}${metaLine}`;
  } else if (ev.type === 'city') {
    popupHtml = `<b>🏙️ Just entered ${escapeHtml(ev.cityName || '')}</b> <span class="muted" style="font-size:11px;">(system comment)</span><br>${escapeHtml(cityEventFactsLine(ev))}${metaLine}`;
  } else if (ev.type === 'timezone') {
    popupHtml = `<b>🕐 ${escapeHtml(ev.text || `Just entered the ${ev.tzName || ''} time zone`)}</b> <span class="muted" style="font-size:11px;">(system comment)</span>${metaLine}`;
  } else if (ev.type === 'video') {
    const thumb = ev.driveFileId
      ? `<br><img src="https://drive.google.com/thumbnail?id=${encodeURIComponent(ev.driveFileId)}&sz=w200" style="max-width:200px;max-height:200px;" onerror="this.remove()">`
      : '';
    popupHtml = `<b>🎥 Video</b>${thumb}<br><a href="${escapeHtml(ev.url || '#')}" target="_blank" rel="noopener">▶ Watch on Google Drive</a>${metaLine}`;
  } else {
    const src = `data:${ev.mediaType || 'image/jpeg'};base64,${ev.mediaData}`;
    const filename = `trip-photo-${(ev.createdAt && ev.createdAt.toDate) ? ev.createdAt.toDate().getTime() : Date.now()}.jpg`;
    popupHtml = `<b>📷 Photo</b><br>
      <img src="${src}" class="event-photo-img" style="max-width:220px;max-height:220px;cursor:pointer;display:block;margin:6px 0;" alt="Trip photo — tap to enlarge">
      <div class="event-item-actions">
        <a href="${src}" download="${filename}" class="ghost-btn small">⬇ Save</a>
        <button type="button" class="ghost-btn small share-photo-btn">📤 Share</button>
      </div>${metaLine}`;
  }
  return L.marker([ev.lat, ev.lon], { icon }).bindPopup(popupHtml);
}

function renderOwnEventMarkers(events) {
  if (!state.map) return;
  clearMarkers(state.eventMarkers);
  events.forEach((ev) => {
    if (typeof ev.lat !== 'number' || typeof ev.lon !== 'number') return;
    state.eventMarkers.push(makeEventMarker(ev).addTo(state.map));
  });
}

/* --- Photo lightbox + save/share, shared by the driver's own trip log and
   every viewer's event list/map pins (any element with class
   event-photo-img opens it; wired once via delegated clicks below). --- */

function openPhotoLightbox(src) {
  const lb = document.getElementById('photoLightbox');
  const img = document.getElementById('lightboxImg');
  const saveBtn = document.getElementById('lightboxSaveBtn');
  if (!lb || !img) return;
  img.src = src;
  lb.dataset.src = src; // read by the Share button below
  if (saveBtn) {
    saveBtn.href = src;
    saveBtn.download = 'trip-photo-' + Date.now() + '.jpg';
  }
  lb.classList.remove('hidden');
}

function closePhotoLightbox() {
  const lb = document.getElementById('photoLightbox');
  const img = document.getElementById('lightboxImg');
  if (lb) lb.classList.add('hidden');
  if (img) img.src = '';
}

// Uses the Web Share API (native share sheet — Messages, email, save to
// Photos, etc.) when the browser supports sharing files; otherwise just
// opens the photo in a new tab so it can be saved/shared manually.
async function sharePhotoDataUrl(dataUrl) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const file = new File([blob], 'trip-photo.jpg', { type: blob.type || 'image/jpeg' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Trip photo' });
    } else {
      window.open(dataUrl, '_blank');
    }
  } catch (e) {
    if (e && e.name !== 'AbortError') { // AbortError = user just closed the share sheet
      toast("Couldn't share photo: " + e.message, 5000);
    }
  }
}

function wireEventActions() {
  document.addEventListener('click', (e) => {
    const photoImg = e.target.closest('.event-photo-img');
    if (photoImg) { openPhotoLightbox(photoImg.src); return; }
    const shareBtn = e.target.closest('.share-photo-btn');
    if (shareBtn) {
      // Works whether the button lives in a trip-log list item (.event-item)
      // or a Leaflet map-pin popup (which wraps its content in
      // .leaflet-popup-content instead) — find whichever container holds it.
      const container = shareBtn.closest('.event-item') || shareBtn.closest('.leaflet-popup-content');
      const img = container && container.querySelector('.event-photo-img');
      if (img) sharePhotoDataUrl(img.src);
      return;
    }
    if (e.target.closest('#lightboxShareBtn')) {
      const lb = document.getElementById('photoLightbox');
      if (lb && lb.dataset.src) sharePhotoDataUrl(lb.dataset.src);
      return;
    }
    if (e.target.id === 'lightboxCloseBtn' || e.target.id === 'photoLightbox') {
      closePhotoLightbox();
    }
  });
}

// A watch link is just this same page's own address with ?watch=PIN tacked
// on — built from wherever the app is actually being loaded from right
// now, rather than a hardcoded address, so it keeps working if this ever
// moves to a different GitHub Pages URL or a custom domain. See
// getAutoWatchPinFromUrl()/watchTripFromLink() for the receiving side.
function buildShareUrl(pin) {
  return `${window.location.origin}${window.location.pathname}?watch=${pin}`;
}

async function copyShareLink(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied — paste it into a text or email.', 4000);
  } catch (e) {
    // Clipboard API can be unavailable (older browser, or blocked
    // permission) — select the text in the link box so it can still be
    // copied by hand as a fallback.
    const input = document.getElementById('shareLinkInput');
    if (input) { input.focus(); input.select(); input.setSelectionRange(0, 99999); }
    toast("Couldn't auto-copy — the link is selected above, copy it by hand.", 5000);
  }
}

function renderSharePanel() {
  const panel = document.getElementById('sharePanel');
  if (!panel) return;
  if (!firebaseConfigured()) {
    panel.innerHTML = '<span class="muted">Not set up yet — see README.md section 7 to enable live sharing, photos, videos, and comments with family.</span>';
    return;
  }
  const sh = state.share;
  if (!sh.active) {
    panel.innerHTML = `
      <div class="hint">Share your live position, photos, videos, and comments with family for this leg — they watch by entering a passcode, no app or account needed on their end.</div>
      <button id="startSharingBtn" class="primary-btn" style="margin-top:10px;">Start Sharing This Leg</button>`;
    document.getElementById('startSharingBtn').onclick = startSharing;
    return;
  }
  // A new photo/comment/video arriving from subscribeOwnEvents() rebuilds
  // this whole panel below, same as it always has — but that would also
  // wipe out (and un-focus) anything you're mid-typing in the comment or
  // video-link box when it happens to land at the wrong moment. Capture
  // and restore that in-progress state around the rebuild so typing never
  // gets silently lost.
  const preserved = captureShareInputState();

  const eventsHtml = sh.events.length
    ? sh.events.map(renderEventItem).join('') + (sh.events.length >= EVENTS_LIVE_LIMIT
        ? `<div class="muted" style="padding:8px 0;font-size:12px;">Showing the most recent ${EVENTS_LIVE_LIMIT} — older photos/comments still exist, just not listed here.</div>`
        : '')
    : '<div class="muted" style="padding:8px 0;">No photos, videos, or comments yet.</div>';
  const shareUrl = buildShareUrl(sh.pin);
  const tripTitleHtml = state.currentLegLabel
    ? escapeHtml(state.currentLegLabel)
    : '<span class="muted">Untitled trip — tap ✏️ to name it</span>';
  // Multi-day trip plan indicator: shows which day is currently being
  // driven, plus a collapsible list of every planned day so you can
  // double-check the whole itinerary is right without leaving this panel.
  // Family sees the equivalent of this on the watch screen (see
  // renderWatchItinerary()) — this is just the driver's own view of it.
  const itineraryHtml = state.itinerary ? `
    <div class="itinerary-day-badge">📅 Day ${state.itinerary.currentLegIdx + 1} of ${state.itinerary.legs.length}</div>
    <details class="itinerary-details">
      <summary>View full trip plan (${state.itinerary.legs.length} days)</summary>
      <div class="legs-list">
        ${state.itinerary.legs.map((leg, i) => `
          <div class="leg-item${i === state.itinerary.currentLegIdx ? ' leg-item-current' : ''}">
            <span class="leg-item-num">${i === state.itinerary.currentLegIdx ? '📍' : (i < state.itinerary.currentLegIdx ? '✅' : (i + 1))}</span>
            <span class="leg-item-label">${escapeHtml(leg.label || leg.destLabel || ('Day ' + (i + 1)))}</span>
          </div>`).join('')}
      </div>
    </details>` : '';
  panel.innerHTML = `
    ${itineraryHtml}
    <div class="trip-title-row">
      <div class="trip-title-text">${tripTitleHtml}</div>
      <button id="editTripLabelBtn" class="ghost-btn small" title="Rename this trip">✏️</button>
    </div>
    <div class="share-pin-box">
      <div class="share-pin-lbl">Link to watch this trip — just tap it, nothing to type</div>
      <input id="shareLinkInput" class="share-link-input" type="text" readonly value="${escapeHtml(shareUrl)}">
      <div class="share-link-actions">
        <button id="shareLinkBtn" class="primary-btn small">📤 Share Link</button>
        <button id="copyLinkBtn" class="ghost-btn small">📋 Copy</button>
      </div>
      <details class="pin-fallback">
        <summary>Or give them the 6-digit passcode instead</summary>
        <div class="share-pin-big">${sh.pin}</div>
        <div class="hint">They'd open this same web address themselves, tap "Watch someone else's shared trip," and type this in — useful if the link above doesn't work for some reason.</div>
      </details>
      <div id="viewerCountBadge" class="viewer-count-badge">👀 ${sh.viewerCount || 0} watching now</div>
      ${sh.paused ? '<div class="paused-badge">🌙 Paused — family sees you\'re taking a break</div>' : ''}
    </div>
    <div class="share-actions">
      <button id="addPhotoBtn" class="ghost-btn small">📷 Add Photo</button>
      <button id="addVideoBtn" class="ghost-btn small">🎥 Video Link</button>
      <button id="addCommentBtn" class="ghost-btn small">💬 Comment</button>
      <button id="pauseSharingBtn" class="ghost-btn small">${sh.paused ? '▶ Resume Sharing' : '⏸ Pause for the Night'}</button>
      <button id="stopSharingBtn" class="ghost-btn small">Stop Sharing</button>
    </div>
    <div id="photoChoiceRow" class="comment-input-row hidden">
      <button id="takePhotoBtn" class="ghost-btn small">📷 Take Photo</button>
      <button id="choosePhotoBtn" class="ghost-btn small">🖼 Choose from Gallery</button>
    </div>
    <div id="videoLinkInputRow" class="comment-input-row hidden">
      <input id="videoLinkTextInput" type="url" placeholder="Paste Google Drive share link…" maxlength="500">
      <button id="videoLinkSendBtn" class="ghost-btn small">Add</button>
    </div>
    <div id="videoLinkHint" class="hint hidden">Record with your phone's normal camera, upload it to Google Drive, tap Share → set to "Anyone with the link," then paste that link here — no upload happens through this app.</div>
    <div id="commentInputRow" class="comment-input-row hidden">
      <input id="commentTextInput" type="text" placeholder="Say something about where you are…" maxlength="500">
      <button id="commentSendBtn" class="ghost-btn small">Send</button>
    </div>
    <div class="event-list">${eventsHtml}</div>`;

  document.getElementById('editTripLabelBtn').onclick = updateTripLabel;
  document.getElementById('shareLinkInput').onclick = (e) => e.target.select();
  document.getElementById('shareLinkBtn').onclick = async () => {
    // On a phone, this opens the normal share sheet (Messages, email,
    // whatever they've got) with the link pre-filled — the closest thing
    // to "just send it" for someone who isn't comfortable copy/pasting.
    // Not every browser offers it (mainly a desktop-browser gap), so fall
    // back to copying the link there instead.
    if (navigator.share) {
      try { await navigator.share({ title: 'Follow my road trip', text: 'Watch my trip live:', url: shareUrl }); }
      catch (e) { /* user backed out of the share sheet — not an error */ }
    } else {
      copyShareLink(shareUrl);
    }
  };
  document.getElementById('copyLinkBtn').onclick = () => copyShareLink(shareUrl);

  document.getElementById('addPhotoBtn').onclick = () => {
    document.getElementById('photoChoiceRow').classList.toggle('hidden');
  };
  document.getElementById('takePhotoBtn').onclick = () => {
    document.getElementById('photoChoiceRow').classList.add('hidden');
    document.getElementById('mediaFileInputCamera').click();
  };
  document.getElementById('choosePhotoBtn').onclick = () => {
    document.getElementById('photoChoiceRow').classList.add('hidden');
    document.getElementById('mediaFileInputGallery').click();
  };
  document.getElementById('addVideoBtn').onclick = () => {
    document.getElementById('videoLinkInputRow').classList.toggle('hidden');
    document.getElementById('videoLinkHint').classList.toggle('hidden');
  };
  document.getElementById('addCommentBtn').onclick = () => document.getElementById('commentInputRow').classList.toggle('hidden');
  document.getElementById('pauseSharingBtn').onclick = () => {
    if (sh.paused) resumeSharingFromPause(); else pauseSharingForNight();
  };
  // Confirm first — an accidental tap here (a bump in the road, a mis-tap
  // reaching for the photo button) used to silently cut off live sharing
  // with no way to catch it before family started seeing "position may be
  // stale." Stays a plain window.confirm(), same pattern already used for
  // removing a "My past trip logs" entry, rather than a custom modal.
  document.getElementById('stopSharingBtn').onclick = () => {
    if (!window.confirm('Stop sharing your live position?\n\nFamily keeps access to this leg\'s route, photos, and comments afterward — just no more live position updates. This doesn\'t end the leg itself; you can keep driving and navigating normally.')) return;
    stopSharing();
  };
  document.getElementById('videoLinkSendBtn').onclick = () => {
    const input = document.getElementById('videoLinkTextInput');
    addVideoLink(input.value);
    input.value = '';
    document.getElementById('videoLinkInputRow').classList.add('hidden');
    document.getElementById('videoLinkHint').classList.add('hidden');
  };
  document.getElementById('videoLinkTextInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('videoLinkSendBtn').click();
  });
  document.getElementById('commentSendBtn').onclick = () => {
    const input = document.getElementById('commentTextInput');
    addComment(input.value);
    input.value = '';
    document.getElementById('commentInputRow').classList.add('hidden');
  };
  document.getElementById('commentTextInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('commentSendBtn').click();
  });

  restoreShareInputState(preserved);
}

// Snapshot of whatever's currently open/typed in the Share panel's
// comment/video-link boxes, taken right before renderSharePanel() replaces
// the panel's innerHTML wholesale (which would otherwise silently discard
// it — including mid-keystroke, since the old input element is destroyed
// and a fresh empty one takes its place).
function captureShareInputState() {
  const commentInput = document.getElementById('commentTextInput');
  const videoInput = document.getElementById('videoLinkTextInput');
  const commentRow = document.getElementById('commentInputRow');
  const videoRow = document.getElementById('videoLinkInputRow');
  const photoRow = document.getElementById('photoChoiceRow');
  return {
    commentValue: commentInput ? commentInput.value : '',
    commentOpen: !!(commentRow && !commentRow.classList.contains('hidden')),
    commentFocused: document.activeElement === commentInput,
    commentSelStart: commentInput ? commentInput.selectionStart : null,
    commentSelEnd: commentInput ? commentInput.selectionEnd : null,
    videoValue: videoInput ? videoInput.value : '',
    videoOpen: !!(videoRow && !videoRow.classList.contains('hidden')),
    videoFocused: document.activeElement === videoInput,
    videoSelStart: videoInput ? videoInput.selectionStart : null,
    videoSelEnd: videoInput ? videoInput.selectionEnd : null,
    photoOpen: !!(photoRow && !photoRow.classList.contains('hidden')),
  };
}

// Re-applies whatever captureShareInputState() saved, onto the freshly
// rebuilt panel — reopens the same row, puts the typed text back, and
// restores focus/cursor position so typing can continue exactly where it
// left off, uninterrupted.
function restoreShareInputState(s) {
  if (!s) return;
  const commentInput = document.getElementById('commentTextInput');
  const videoInput = document.getElementById('videoLinkTextInput');
  const commentRow = document.getElementById('commentInputRow');
  const videoRow = document.getElementById('videoLinkInputRow');
  const videoHint = document.getElementById('videoLinkHint');
  const photoRow = document.getElementById('photoChoiceRow');
  if (s.commentOpen && commentRow) commentRow.classList.remove('hidden');
  if (s.videoOpen) {
    if (videoRow) videoRow.classList.remove('hidden');
    if (videoHint) videoHint.classList.remove('hidden');
  }
  if (s.photoOpen && photoRow) photoRow.classList.remove('hidden');
  if (commentInput && s.commentValue) commentInput.value = s.commentValue;
  if (videoInput && s.videoValue) videoInput.value = s.videoValue;
  if (s.commentFocused && commentInput) {
    commentInput.focus();
    if (s.commentSelStart != null) commentInput.setSelectionRange(s.commentSelStart, s.commentSelEnd);
  } else if (s.videoFocused && videoInput) {
    videoInput.focus();
    if (s.videoSelStart != null) videoInput.setSelectionRange(s.videoSelStart, s.videoSelEnd);
  }
}

function wireSharing() {
  const handleMediaFile = (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) addPhoto(file);
    e.target.value = '';
  };
  document.getElementById('mediaFileInputCamera').addEventListener('change', handleMediaFile);
  document.getElementById('mediaFileInputGallery').addEventListener('change', handleMediaFile);
  renderSharePanel();
}

/* ============================== WATCH (VIEWER) MODE ============================== */
// The read-only counterpart to sharing above: anyone with the passcode opens
// this same page, enters it, and sees the traveler's route, live position,
// and photo/comment pins update in real time — no account needed.

function wireWatchScreen() {
  const link = document.getElementById('watchTripLink');
  const backBtn = document.getElementById('watchBackBtn');
  const goBtn = document.getElementById('watchGoBtn');
  const pinInput = document.getElementById('watchPinInput');

  link.addEventListener('click', () => {
    document.getElementById('setupScreen').classList.add('hidden');
    document.getElementById('watchScreen').classList.remove('hidden');
    document.getElementById('watchPinEntry').classList.remove('hidden');
    document.getElementById('watchLive').classList.add('hidden');
    document.getElementById('watchError').textContent = '';
    pinInput.value = '';
    pinInput.focus();
  });

  backBtn.addEventListener('click', () => {
    stopWatching();
    document.getElementById('watchScreen').classList.add('hidden');
    document.getElementById('setupScreen').classList.remove('hidden');
  });

  goBtn.addEventListener('click', () => {
    const pin = pinInput.value.trim();
    if (!/^\d{4,8}$/.test(pin)) {
      document.getElementById('watchError').textContent = 'Enter the passcode you were given (numbers only).';
      return;
    }
    watchTrip(pin);
  });
  pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') goBtn.click(); });

  wireViewerMessageBox();
}

// Lets family send a short message to the driver from the watch screen —
// the driver sees it in a panel right below their map and (traffic
// permitting — see announceViewerMessage()) hears it read aloud. There's no
// login here, just a self-typed name, so the driver knows who's writing:
// each device remembers what was typed last time (see LS_VIEWER_NAME) so
// it's a one-time thing per phone, not a re-type-your-name-every-trip
// thing, but it's still just a label someone chose for themselves rather
// than a verified identity — fine for a family trip, not meant as
// anything stronger.
const LS_VIEWER_NAME = 'rtnav_viewer_name_v1';

function loadViewerName() {
  try { return localStorage.getItem(LS_VIEWER_NAME) || ''; } catch (e) { return ''; }
}
function saveViewerName(name) {
  try { localStorage.setItem(LS_VIEWER_NAME, name); } catch (e) { /* localStorage unavailable — just means re-typing the name next time */ }
}

function wireViewerMessageBox() {
  const nameInput = document.getElementById('watchNameInput');
  const msgInput = document.getElementById('watchMessageInput');
  const sendBtn = document.getElementById('watchSendMsgBtn');
  if (!nameInput || !msgInput || !sendBtn) return;
  nameInput.value = loadViewerName();
  sendBtn.addEventListener('click', sendViewerMessage);
  msgInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendViewerMessage(); });
}

// Translates a Firestore write failure into something a family member
// (not a developer) can actually act on. The one case worth calling out
// specifically is 'permission-denied': for the messages/replies rules in
// this app, that always means the trip the write was aimed at isn't
// currently "active" (the security rules re-check that live, server-side,
// at write time) — the same condition the pre-checks above already try to
// catch client-side, using whatever copy of the trip doc this device last
// received. Those two can disagree for a moment: if this device's own
// connection hiccups right as the trip's status changes (the traveler
// ends that leg, or starts a new one with a fresh link), the client-side
// check can still be looking at the old "active" state and let the
// attempt through, only for the server to correctly reject it a moment
// later with a raw "Missing or insufficient permissions" — which reads to
// anyone non-technical like a mysterious authorization failure, not "ask
// for a fresh link." Every other error (a genuine dropped connection,
// something unexpected) still shows its own real message.
function friendlySendErrorMessage(e) {
  if (e && e.code === 'permission-denied') {
    return "This trip isn't active right now — ask for a fresh link.";
  }
  return e && e.message ? e.message : 'Unknown error.';
}

async function sendViewerMessage() {
  const nameInput = document.getElementById('watchNameInput');
  const msgInput = document.getElementById('watchMessageInput');
  const sendBtn = document.getElementById('watchSendMsgBtn');
  const name = (nameInput.value || '').trim().slice(0, 40) || 'Family';
  const text = (msgInput.value || '').trim().slice(0, 300);
  if (!text) { msgInput.focus(); return; }
  if (!state.watch.pin) { toast("Not connected to a trip right now.", 3000); return; }
  // Catch a stopped/stale trip here with a plain-English message instead of
  // letting it fall through to Firestore, which would just deny the write
  // (this trip existing but no longer "active" is exactly what the
  // security rules' create check on messages also requires) and hand back
  // a generic "Missing or insufficient permissions" that means nothing to
  // whoever's actually trying to send a message to a family member.
  if (!state.watch.trip || state.watch.trip.active === false) {
    toast("This trip isn't active right now — ask for a fresh link.", 5000);
    return;
  }
  saveViewerName(name);
  sendBtn.disabled = true;
  try {
    const { db, uid } = await initFirebase();
    await db.collection('trips').doc(state.watch.pin).collection('messages').add({
      text,
      senderName: name,
      senderUid: uid,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    msgInput.value = '';
    toast('Message sent.', 2500);
  } catch (e) {
    toast("Couldn't send: " + friendlySendErrorMessage(e), 5000);
  } finally {
    sendBtn.disabled = false;
  }
}

// Reads a ?watch=123456 passcode off the page's own URL — the other half
// of the shareable link built by buildShareUrl(). Returns null if there's
// no such parameter, or it doesn't look like a real passcode (so a
// mistyped/garbled link falls back to the normal setup screen instead of
// erroring out).
function getAutoWatchPinFromUrl() {
  const pin = (new URLSearchParams(window.location.search).get('watch') || '').trim();
  return /^\d{4,8}$/.test(pin) ? pin : null;
}

// Called once at startup when the page was opened via a shared watch link
// (see getAutoWatchPinFromUrl()) — jumps straight past the setup screen
// and the passcode-entry step into the live trip view, which is the whole
// point: someone who isn't comfortable with apps just taps the link their
// family member sent and is watching, no typing required.
async function watchTripFromLink(pin) {
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('watchScreen').classList.remove('hidden');
  document.getElementById('watchPinEntry').classList.add('hidden');
  document.getElementById('watchLive').classList.remove('hidden');
  document.getElementById('watchPinInput').value = pin;
  renderWatchStatus('Connecting…');
  await watchTrip(pin);
  // watchTrip() only shows its errors in #watchError, which lives inside
  // the passcode-entry panel we just hid — if it failed (bad/expired
  // passcode), reveal that panel so the error is actually visible, with
  // the passcode from the link already filled in in case it just needs a
  // retry.
  if (document.getElementById('watchError').textContent) {
    document.getElementById('watchPinEntry').classList.remove('hidden');
    document.getElementById('watchLive').classList.add('hidden');
  }
}

async function watchTrip(pin) {
  const errEl = document.getElementById('watchError');
  errEl.textContent = '';
  if (!firebaseConfigured()) {
    errEl.textContent = "Trip sharing isn't set up in this app yet — ask the traveler to check README.md section 7.";
    return;
  }
  try {
    const { db, uid } = await initFirebase();
    const snap = await db.collection('trips').doc(pin).get();
    if (!snap.exists) { errEl.textContent = 'No trip found with that passcode.'; return; }

    stopWatching();
    state.watch.pin = pin;
    document.getElementById('watchPinEntry').classList.add('hidden');
    document.getElementById('watchLive').classList.remove('hidden');
    setTimeout(initWatchMap, 0);

    // Let the traveler see that someone's watching (as a simple count, on
    // their screen only — this app never shows a viewer who else is
    // watching). Just a lightweight "I'm here" heartbeat, refreshed every
    // 30s while this screen stays open.
    state.watch.presenceUid = uid;
    const writePresence = () => {
      db.collection('trips').doc(pin).collection('viewers').doc(uid).set({
        lastSeenAt: firebase.firestore.FieldValue.serverTimestamp(),
      }).catch(() => { /* best effort */ });
    };
    writePresence();
    state.watch.presenceInterval = setInterval(writePresence, 30000);

    state.watch.unsubTrip = db.collection('trips').doc(pin).onSnapshot((doc) => {
      if (!doc.exists) { renderWatchStatus('This trip is no longer available.'); return; }
      state.watch.trip = doc.data();
      renderWatchTrip();
    }, (e) => renderWatchStatus('Connection error: ' + e.message));

    state.watch.unsubEvents = db.collection('trips').doc(pin).collection('events')
      .orderBy('createdAt', 'desc')
      .limit(EVENTS_LIVE_LIMIT)
      .onSnapshot((qs) => {
        const events = [];
        qs.forEach((d) => events.push({ id: d.id, ...d.data() }));
        state.watch.events = events;
        renderWatchEvents(events);
      });

    subscribeViewerReplies(pin, uid);
  } catch (e) {
    errEl.textContent = "Couldn't connect: " + e.message;
  }
}

// A reply the traveler sent back to just this viewer (see startVoiceReply()
// on the driver side) — filtered to messages targeting this device's own
// uid. No orderBy in the query itself (a where + orderBy on a different
// field needs a composite index Firestore would otherwise ask you to
// create by hand); replies are few enough that sorting the small result
// set here in JS is simpler than adding one more manual setup step.
function subscribeViewerReplies(pin, myUid) {
  if (state.watch.unsubReplies) { state.watch.unsubReplies(); state.watch.unsubReplies = null; }
  state.watch.replies = [];
  state.watch.repliesLoaded = false;
  state.watch.unsubReplies = state.fb.db.collection('trips').doc(pin).collection('replies')
    .where('toUid', '==', myUid)
    .onSnapshot((snap) => {
      const wasAlreadyLoaded = state.watch.repliesLoaded;
      state.watch.repliesLoaded = true;
      let gotNew = false;
      snap.docChanges().forEach((change) => {
        if (change.type !== 'added') return;
        const d = change.doc.data();
        state.watch.replies.push({
          id: change.doc.id,
          text: d.text || '',
          createdAt: (d.createdAt && typeof d.createdAt.toMillis === 'function') ? d.createdAt.toMillis() : Date.now(),
        });
        gotNew = true;
      });
      if (gotNew) {
        renderViewerReplies();
        if (wasAlreadyLoaded) toast('🚗 The traveler replied!', 4000);
      }
    }, (e) => toast('Reply sync error: ' + e.message, 6000));
}

function renderViewerReplies() {
  const panel = document.getElementById('viewerRepliesPanel');
  const list = document.getElementById('viewerRepliesList');
  if (!panel || !list) return;
  const replies = state.watch.replies;
  if (!replies.length) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');
  list.innerHTML = replies.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 20).map((r) => {
    const when = new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    return `<div class="viewer-message viewer-reply">
      <div class="viewer-message-meta">🚗 The traveler · ${when}</div>
      <div class="viewer-message-text">${escapeHtml(r.text)}</div>
    </div>`;
  }).join('');
}

function stopWatching() {
  if (state.watch.unsubTrip) { state.watch.unsubTrip(); state.watch.unsubTrip = null; }
  if (state.watch.unsubEvents) { state.watch.unsubEvents(); state.watch.unsubEvents = null; }
  if (state.watch.unsubReplies) { state.watch.unsubReplies(); state.watch.unsubReplies = null; }
  state.watch.replies = [];
  state.watch.repliesLoaded = false;
  if (state.watch.presenceInterval) { clearInterval(state.watch.presenceInterval); state.watch.presenceInterval = null; }
  if (state.fb && state.watch.pin && state.watch.presenceUid) {
    // Best-effort — leaving means "not watching," so remove the presence
    // doc rather than letting it linger until it ages out on its own.
    state.fb.db.collection('trips').doc(state.watch.pin).collection('viewers').doc(state.watch.presenceUid)
      .delete().catch(() => { /* best effort */ });
  }
  state.watch.presenceUid = null;
  state.watch.pin = null;
  state.watch.trip = null;
  state.watch.events = [];
  state.watch.eventMarkers = {};
  state.watch.weatherFetchedAt = 0;
  state.watch.weatherLoc = null;
  state.watch.peaksFetchedAt = 0;
  state.watch.peaksLoc = null;
  if (state.watch.map) { state.watch.map.remove(); state.watch.map = null; }
  state.watch.routeLine = null;
  state.watch.routeCoordsVersion = undefined; // undefined (not null) marks "never drawn yet" — see renderWatchTrip()
  state.watch.liveMarker = null;
  state.watch.etaTapMarker = null; // destroyed along with the map above
  state.watch.itineraryLine = null; // destroyed along with the map above
  state.watch.overnightMarkers = []; // destroyed along with the map above
  state.watch.itineraryDrawn = false;
  state.watch.fullscreen = false;
  document.getElementById('watchScreen').classList.remove('watch-fullscreen');
  const itinPanel = document.getElementById('watchItineraryPanel');
  if (itinPanel) itinPanel.classList.add('hidden');
  renderViewerReplies(); // clears/hides any replies shown from the trip just left
}

// A plain up-arrow rotated to the reported heading reads as a direction-of-
// travel indicator at a glance; when heading isn't available (GPS reports
// none while stopped, on some devices), fall back to a plain car glyph.
function liveMarkerIcon(heading) {
  const hasHeading = typeof heading === 'number' && !isNaN(heading);
  const glyph = hasHeading ? '⬆️' : '🚗';
  const style = hasHeading ? ` style="transform:rotate(${heading}deg)"` : '';
  return L.divIcon({
    className: 'live-marker',
    html: `<div class="live-marker-icon"${style}>${glyph}</div>`,
    iconSize: [30, 30], iconAnchor: [15, 15],
  });
}

// Speed + direction of travel, shown in a tap-to-open popup on the live
// marker rather than an always-visible banner — family watching asked for
// this, since a permanent label right above the marker covered up both the
// route line and the marker itself on a phone-sized map.
function liveMarkerStatusText(loc) {
  const speedMph = (typeof loc.speed === 'number' && loc.speed >= 0) ? Math.round(loc.speed * MPS_TO_MPH) : null;
  const dirTxt = (typeof loc.heading === 'number' && !isNaN(loc.heading)) ? compass(loc.heading) : null;
  const parts = [];
  if (speedMph != null) parts.push(speedMph + ' mph');
  if (dirTxt) parts.push('heading ' + dirTxt);
  return parts.length ? parts.join(' · ') : 'Stopped';
}

function renderWatchWeather(text) {
  const el = document.getElementById('watchWeather');
  if (el) el.textContent = text;
}

// Reuses the same NWS lookup the main app uses for "Weather Ahead" — free,
// no key, US-only — but here it's just current conditions at the traveler's
// live spot. Throttled the same way (time + distance) to avoid hammering
// NWS every time a new location update arrives.
async function maybeRefreshWatchWeather(loc) {
  const w = state.watch;
  const now = Date.now();
  const movedFar = !w.weatherLoc || haversineMiles(w.weatherLoc.lat, w.weatherLoc.lon, loc.lat, loc.lon) > 5;
  if (w.weatherFetchedAt && now - w.weatherFetchedAt < 10 * 60 * 1000 && !movedFar) return;
  w.weatherFetchedAt = now;
  w.weatherLoc = { lat: loc.lat, lon: loc.lon };
  try {
    const periods = await nwsForecastAt(loc.lat, loc.lon);
    const cur = periods[0];
    renderWatchWeather(`Trip current location: 🌦 ${cur.temperature}°${cur.temperatureUnit} — ${cur.shortForecast} · wind ${cur.windSpeed}`);
  } catch (e) {
    renderWatchWeather('Trip current location: weather unavailable here (US only).');
  }
}

// Same idea as the driver's own "⛰ Mountains Nearby" panel (refreshPeaks()),
// reusing the same free Overpass lookup, but centered on the traveler's
// live position instead of the viewer's own. Throttled a bit more gently
// than the driver's copy (15 min / 10 mi vs. 8/8) since this runs on top of
// whatever the traveler's own phone is already asking Overpass for, and
// there may be more than one viewer doing this at once.
//
// Unlike the driver's own copy of this panel, this one only ever populates
// the "⛰ Mountains Nearby" list below the map — no map pins — by request
// from family watching: pins (plus the driver's live position and photo/
// event pins) were crowding the map on a phone-sized screen. state.watch
// no longer keeps a peakMarkers array as a result.
async function maybeRefreshWatchPeaks(loc) {
  const w = state.watch;
  const now = Date.now();
  const movedFar = !w.peaksLoc || haversineMiles(w.peaksLoc.lat, w.peaksLoc.lon, loc.lat, loc.lon) > 10;
  if (w.peaksFetchedAt && now - w.peaksFetchedAt < 15 * 60 * 1000 && !movedFar) return;
  w.peaksFetchedAt = now;
  w.peaksLoc = { lat: loc.lat, lon: loc.lon };

  const panel = document.getElementById('watchPeaksPanel');
  const radiusM = 64000; // ~40 mi, same radius as the driver's own panel
  const ql = `[out:json][timeout:20];
(
  node["natural"="peak"]["name"]["ele"](around:${radiusM},${loc.lat},${loc.lon});
);
out 60;`;
  try {
    const json = await overpassQuery(ql);
    let items = json.elements.map((el) => {
      const dist = haversineMiles(loc.lat, loc.lon, el.lat, el.lon);
      const brg = bearingDeg(loc.lat, loc.lon, el.lat, el.lon);
      const eleM = parseFloat(el.tags.ele);
      return { name: el.tags.name, eleFt: Math.round(eleM * M_TO_FT), dist, brg, lat: el.lat, lon: el.lon };
    }).filter((el) => !isNaN(el.eleFt));
    items.sort((a, b) => a.dist - b.dist);
    items = items.slice(0, 10);

    if (panel) {
      panel.innerHTML = items.length
        ? items.map((el) => `
            <div class="item-row"><div>
              <div class="item-main">⛰ ${el.name}</div>
              <div class="item-sub">${el.eleFt.toLocaleString()} ft elev · ${compass(el.brg)} of the traveler</div>
            </div><div class="item-right">${fmtMiles(el.dist)}</div></div>`).join('')
        : '<span class="muted">No named peaks with elevation data within 40 miles.</span>';
    }
  } catch (e) {
    if (panel) panel.innerHTML = `<span class="muted">Peak lookup error: ${e.message}</span>`;
  }
}

function initWatchMap() {
  if (state.watch.map) return;
  const map = L.map('watchMap', { zoomControl: true }).setView([37.5, -96], 4);
  // Same two custom panes as the driver's own map (see initMap()'s
  // comment) so the route line renders underneath the road/place name
  // reference layers instead of covering the street names and highway
  // shields it runs along.
  map.createPane('routePane');
  map.getPane('routePane').style.zIndex = 300;
  map.createPane('roadLabelsPane');
  map.getPane('roadLabelsPane').style.zIndex = 350;
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Imagery &copy; Esri' }).addTo(map);
  // Road network + street name labels, then place-name/boundary labels
  // (cities, counties, water bodies) on top — same two reference layers,
  // same stacking order, as the driver's own satellite view (see
  // initMap()), so a watcher gets actual street names too, not just a bare
  // aerial photo.
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri', pane: 'roadLabelsPane' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri', pane: 'roadLabelsPane' }).addTo(map);
  state.watch.map = map;
  drawTimezoneLines(map);
  state.watch.fullscreen = false;
  addFullscreenToggleControl(map, () => state.watch.fullscreen, toggleWatchFullscreen);

  // Same auto-follow behavior as the driver's own map: recenters on the
  // traveler's live position as it updates, pauses if you drag to look
  // around, and a Recenter button brings it back.
  state.watch.followMe = true;
  addRecenterControl(
    map,
    (v) => { state.watch.followMe = v; },
    () => state.watch.liveMarker && state.watch.liveMarker.getLatLng(),
    (div) => { state.watch.recenterBtnDiv = div; },
  );
  map.on('dragstart', () => {
    if (state.watch.followMe) {
      state.watch.followMe = false;
      if (state.watch.recenterBtnDiv) state.watch.recenterBtnDiv.classList.remove('hidden');
    }
  });

  if (state.watch.trip) renderWatchTrip();
  if (state.watch.events) renderWatchEvents(state.watch.events);

  // Tap-anywhere-for-ETA, viewer side — see handleWatchMapTapForEta(). A
  // viewer has no ORS key of their own, so this estimates off the
  // cumDist/cumDur already baked into each shared route sample point
  // instead of doing live routing.
  map.on('click', (e) => { handleWatchMapTapForEta(e.latlng.lat, e.latlng.lng); });

  addMapHelpControl(map, 'map-watch');
}

// Finds the sample point in a shared route (as produced by
// sampleRouteForShare()) nearest a given lat/lon, straight-line. Returns
// {point, dist} where dist is in miles, or null if there are no points.
function nearestSharedRoutePoint(routeCoords, lat, lon) {
  if (!routeCoords || !routeCoords.length) return null;
  let best = null, bestD = Infinity;
  for (const p of routeCoords) {
    const d = haversineMiles(lat, lon, p.lat, p.lon);
    if (d < bestD) { bestD = d; best = p; }
  }
  return { point: best, dist: bestD };
}

// Viewer-side counterpart to handleMapTapForEta(). Viewers never have an
// ORS key, so there's no live routing available — instead this estimates
// using the cumDist/cumDur that ride along on every shared route sample
// point: snap the tapped spot and the traveler's current position each to
// their nearest sample, then the difference in cumDur is the estimated
// remaining drive time. This only works well for taps at or near the
// shared route line itself; a tap well off of it still snaps to the
// nearest point on the route, so the popup calls out the straight-line
// distance from the tap to that snapped point when it's large enough to
// matter, rather than silently presenting a misleading estimate.
function handleWatchMapTapForEta(lat, lon) {
  const trip = state.watch.trip;
  const map = state.watch.map;
  if (!trip || !map) return;
  if (state.watch.etaTapMarker) { map.removeLayer(state.watch.etaTapMarker); state.watch.etaTapMarker = null; }
  const marker = L.marker([lat, lon]).addTo(map);
  state.watch.etaTapMarker = marker;

  if (!trip.routeCoords || !trip.routeCoords.length || !trip.lastLocation) {
    marker.bindPopup('<div style="min-width:160px;">Not enough route data yet to estimate this.</div>').openPopup();
    return;
  }
  const tapped = nearestSharedRoutePoint(trip.routeCoords, lat, lon);
  const current = nearestSharedRoutePoint(trip.routeCoords, trip.lastLocation.lat, trip.lastLocation.lon);
  if (!tapped || !current) {
    marker.bindPopup('<div style="min-width:160px;">Couldn\'t estimate this spot.</div>').openPopup();
    return;
  }
  const remainingSec = tapped.point.cumDur - current.point.cumDur;
  const aheadMiles = tapped.point.cumDist - current.point.cumDist;
  const offRouteNote = tapped.dist > 3
    ? `<br><span class="muted" style="font-size:12px;">(nearest point on their route is ${fmtMiles(tapped.dist)} from your tap — estimate only)</span>`
    : '';

  let body;
  if (remainingSec < -60) {
    body = `<b>Already passed</b> — about ${fmtDurationShort(-remainingSec)} ago`;
  } else {
    const etaTime = fmtClockFromNowPlus(Math.max(0, remainingSec));
    const etaDate = etaDateLabel(Math.max(0, remainingSec));
    body = `${fmtMiles(Math.max(0, aheadMiles))} ahead of them · ${fmtDurationShort(Math.max(0, remainingSec))} more driving<br><b>Est. ETA ${etaTime}${etaDate ? ' · ' + etaDate : ''}</b>`;
  }
  // Elevation is only as good as the nearest shared route sample (an
  // approximation, same caveat as offRouteNote above) — but weather needs
  // no API key, so it's fetched live and exact directly from this browser,
  // same as the driver gets. Weather is fetched after opening the popup so
  // the ETA itself is never held up waiting on the network.
  const elevFt = typeof tapped.point.elevFt === 'number' ? tapped.point.elevFt : null;
  marker.bindPopup(`<div style="min-width:190px;">${body}${tapEtaExtrasLine(elevFt, null)}${offRouteNote}<br><span class="muted" style="font-size:12px;">Getting current weather…</span></div>`).openPopup();

  nwsCurrentConditionsAt(lat, lon).then((weather) => {
    if (!marker.isPopupOpen()) return;
    marker.setPopupContent(`<div style="min-width:190px;">${body}${tapEtaExtrasLine(elevFt, weather)}${offRouteNote}</div>`);
  });
}

function renderWatchStatus(msg) {
  const el = document.getElementById('watchStatus');
  if (el) el.textContent = msg;
}

function renderWatchTrip() {
  const trip = state.watch.trip;
  if (!trip) return;
  const map = state.watch.map;

  // The traveler's chosen name for this trip/leg (optional — see "Label
  // this leg" on their setup screen, and the ✏️ rename button on their
  // Share & Trip Log panel). Hidden entirely rather than showing a
  // placeholder when they haven't named it, so an unnamed trip just looks
  // the way this screen always used to look.
  const titleEl = document.getElementById('watchTripTitle');
  if (titleEl) {
    const isMultiDay = trip.itineraryLegs && trip.itineraryLegs.length > 1;
    const dayTag = isMultiDay ? ` (Day ${(trip.currentLegIndex || 0) + 1} of ${trip.itineraryLegs.length})` : '';
    if (trip.legLabel) { titleEl.textContent = trip.legLabel + dayTag; titleEl.classList.remove('hidden'); }
    else if (dayTag) { titleEl.textContent = dayTag.trim(); titleEl.classList.remove('hidden'); }
    else { titleEl.textContent = ''; titleEl.classList.add('hidden'); }
  }

  renderWatchItinerary(trip);

  // Elevation is already sitting on the trip doc (the driver computes it
  // for free off their own route data — see currentElevationFt()), so this
  // is just a display, no extra lookup needed.
  const elevEl = document.getElementById('watchElevation');
  if (elevEl) {
    const ef = trip.lastLocation && typeof trip.lastLocation.elevationFt === 'number' ? trip.lastLocation.elevationFt : null;
    elevEl.textContent = ef != null ? `⛰ Traveler's current elevation: ${ef.toLocaleString()} ft` : '';
  }

  // Part of a multi-day trip plan (see calculateTripPlan()/startSharing()):
  // a light, dashed overview of the WHOLE planned route, plus a marker at
  // each overnight stop and the final destination, drawn once up front so
  // family can see the full trip from the moment they open the link —
  // not just today's leg. Drawn here, BEFORE the current day's routeLine
  // below, so — sharing the same 'routePane' — it stacks underneath that
  // brighter, solid "today" line rather than competing with it. Only ever
  // drawn once (state.watch.itineraryDrawn) since the overview is a
  // snapshot from planning time; it isn't expected to change day to day,
  // unlike today's own route which redraws on every reroute.
  if (map && !state.watch.itineraryDrawn && trip.itineraryFullRouteCoords && trip.itineraryFullRouteCoords.length) {
    const latlngs = trip.itineraryFullRouteCoords.map((p) => [p.lat, p.lon]);
    state.watch.itineraryLine = L.polyline(latlngs, {
      color: '#a855f7', weight: 4, opacity: 0.45, dashArray: '2,10', pane: 'routePane',
    }).addTo(map);
    if (trip.itineraryLegs && trip.itineraryLegs.length) {
      trip.itineraryLegs.forEach((leg, i) => {
        const isFinal = i === trip.itineraryLegs.length - 1;
        const icon = L.divIcon({
          className: 'event-marker',
          html: `<div class="${isFinal ? 'final-marker-icon' : 'overnight-marker-icon'}">${isFinal ? '🏁' : '🌙'}</div>`,
          iconSize: [28, 28], iconAnchor: [14, 25],
        });
        const label = leg.label || leg.destLabel || (isFinal ? 'Final destination' : `Overnight stop ${i + 1}`);
        const marker = L.marker([leg.lat, leg.lon], { icon })
          .bindPopup(`${isFinal ? '🏁' : '🌙'} ${escapeHtml(label)}${isFinal ? '' : ' — overnight stop'}`)
          .addTo(map);
        state.watch.overnightMarkers.push(marker);
      });
    }
    state.watch.itineraryDrawn = true;
  }

  // Redraws the route line not just the first time, but whenever the
  // traveler reroutes too — see performReroute()/maybePushShareLocation()
  // on their side, which is what actually sends the updated routeCoords.
  // routeUpdatedAt changing (a cheap timestamp compare) is how this tells
  // "the route actually changed" apart from an ordinary location-only
  // update, without diffing 300 points on every single snapshot.
  if (map && trip.routeCoords && trip.routeCoords.length) {
    const routeVersion = (trip.routeUpdatedAt && typeof trip.routeUpdatedAt.toMillis === 'function') ? trip.routeUpdatedAt.toMillis() : null;
    if (state.watch.routeCoordsVersion !== routeVersion) {
      const isFirstDraw = state.watch.routeCoordsVersion === undefined;
      if (state.watch.routeLine) { map.removeLayer(state.watch.routeLine); }
      const latlngs = trip.routeCoords.map((p) => [p.lat, p.lon]);
      // pane: 'routePane' (see initWatchMap()) — same fix as the driver's
      // map (drawRoute()): draws underneath the road/place name reference
      // layers so labels and highway shields the route runs along stay
      // legible, regardless of the line's own weight/opacity.
      state.watch.routeLine = L.polyline(latlngs, { color: '#3b82f6', weight: 5, opacity: 0.8, pane: 'routePane' }).addTo(map);
      // Only snap/zoom the viewer's map on the very first draw. A reroute
      // sends a new route that only spans from the traveler's current spot
      // onward, so re-fitting bounds on every redraw would yank a watcher's
      // view away from wherever they'd zoomed/panned to (e.g. looking back
      // over the whole day's pins and photos) and crop it down to just the
      // remaining leg — reading as if the earlier part of the trip had been
      // erased, when it's still there, just off-screen. The toast below is
      // enough of a heads-up; it shouldn't also shove their map around.
      if (isFirstDraw) map.fitBounds(state.watch.routeLine.getBounds(), { padding: [30, 30] });
      state.watch.routeCoordsVersion = routeVersion;
      if (!isFirstDraw) toast("The traveler's route changed — map updated.", 5000);
    }
  }

  if (map && trip.lastLocation) {
    const ll = [trip.lastLocation.lat, trip.lastLocation.lon];
    const icon = liveMarkerIcon(trip.lastLocation.heading);
    const statusText = liveMarkerStatusText(trip.lastLocation);
    if (!state.watch.liveMarker) {
      state.watch.liveMarker = L.marker(ll, { icon })
        .bindPopup(statusText)
        .addTo(map);
    } else {
      state.watch.liveMarker.setLatLng(ll);
      state.watch.liveMarker.setIcon(icon);
      state.watch.liveMarker.setPopupContent(statusText);
    }
    if (state.watch.followMe) {
      map.panTo(ll, { animate: true, duration: 0.5 });
    }
    if (trip.active) {
      maybeRefreshWatchWeather(trip.lastLocation);
      maybeRefreshWatchPeaks(trip.lastLocation);
    }
  }

  const ageSec = trip.lastLocation ? (Date.now() - (trip.lastLocation.updatedAt || 0)) / 1000 : null;
  let status;
  if (!trip.active) status = 'This trip has ended sharing.';
  else if (trip.paused) {
    const pausedMs = trip.pausedAt && trip.pausedAt.toMillis ? Date.now() - trip.pausedAt.toMillis() : null;
    const pausedAgo = pausedMs != null
      ? (pausedMs < 60 * 60 * 1000 ? Math.round(pausedMs / 60000) + 'm' : Math.round(pausedMs / 3600000) + 'h')
      : null;
    status = `🌙 Taking a break${pausedAgo ? ' (' + pausedAgo + ' ago)' : ''} — this will update again once they're back on the road.`;
  }
  else if (!trip.lastLocation) status = "Waiting for the traveler's first location update…";
  else {
    status = `Heading to ${trip.destLabel || 'destination'} · updated ${ageSec < 60 ? Math.round(ageSec) + 's' : Math.round(ageSec / 60) + 'm'} ago`;
    // Same estimate as the tap-for-ETA popup (see handleWatchMapTapForEta
    // / nearestSharedRoutePoint): snap the traveler's current position to
    // the shared route's sample points, then the gap between that sample's
    // cumDur and the last sample's cumDur (the route's total duration) is
    // the remaining drive time. Rounded to whole hours per what's asked
    // for here; anything under 30 min still shows as "0" rather than
    // disappearing, so it's clear an estimate is still being offered.
    if (trip.routeCoords && trip.routeCoords.length) {
      const current = nearestSharedRoutePoint(trip.routeCoords, trip.lastLocation.lat, trip.lastLocation.lon);
      if (current) {
        const totalDur = trip.routeCoords[trip.routeCoords.length - 1].cumDur;
        const remainingSec = Math.max(0, totalDur - current.point.cumDur);
        status += ` · Hours to go: ${Math.round(remainingSec / 3600)}`;
        renderTripProgressBar('watchProgressFill', 'watchProgressPct', current.point.cumDist, trip.totalMiles);
      }
    }
    status += (ageSec > 120 ? ' — last known position may be stale' : '');
  }
  renderWatchStatus(status);
}

// Populates the "🗺️ Trip Plan" panel on the watch screen (#watchItineraryPanel
// / #watchItineraryList) with every day of a multi-day trip plan — hidden
// entirely for an ordinary single-leg shared trip (trip.itineraryLegs unset
// or just one entry), same "just looks like it always has" approach as the
// legLabel title handling above.
function renderWatchItinerary(trip) {
  const panel = document.getElementById('watchItineraryPanel');
  const list = document.getElementById('watchItineraryList');
  if (!panel || !list) return;
  if (!trip.itineraryLegs || trip.itineraryLegs.length < 2) {
    panel.classList.add('hidden');
    return;
  }
  panel.classList.remove('hidden');
  const currentIdx = trip.currentLegIndex || 0;
  list.innerHTML = trip.itineraryLegs.map((leg, i) => {
    const label = leg.label || leg.destLabel || ('Day ' + (i + 1));
    const marker = i === currentIdx ? '📍' : (i < currentIdx ? '✅' : (i + 1));
    return `<div class="leg-item${i === currentIdx ? ' leg-item-current' : ''}">
      <span class="leg-item-num">${marker}</span>
      <span class="leg-item-label">${escapeHtml(label)}</span>
    </div>`;
  }).join('');
}

function renderWatchEvents(events) {
  const el = document.getElementById('watchEvents');
  if (!el) return;
  el.innerHTML = events.length
    ? events.map(renderEventItem).join('') + (events.length >= EVENTS_LIVE_LIMIT
        ? `<div class="muted" style="padding:8px 0;font-size:12px;">Showing the most recent ${EVENTS_LIVE_LIMIT} — older photos/comments still exist, just not listed here.</div>`
        : '')
    : '<div class="muted" style="padding:8px 0;">No photos, videos, or comments yet.</div>';

  const map = state.watch.map;
  if (!map) return;
  const seen = new Set();
  events.forEach((ev) => {
    if (typeof ev.lat !== 'number' || typeof ev.lon !== 'number') return;
    seen.add(ev.id);
    if (!state.watch.eventMarkers[ev.id]) {
      state.watch.eventMarkers[ev.id] = makeEventMarker(ev).addTo(map);
    }
  });
  Object.keys(state.watch.eventMarkers).forEach((id) => {
    if (!seen.has(id)) { map.removeLayer(state.watch.eventMarkers[id]); delete state.watch.eventMarkers[id]; }
  });
}

/* ============================== SETUP SCREEN LOGIC ============================== */

function renderLegsList() {
  const el = document.getElementById('legsList');
  if (!state.trip.legs.length) { el.innerHTML = '<span class="muted">No saved legs yet.</span>'; return; }
  el.innerHTML = '';
  state.trip.legs.forEach((leg) => {
    const div = document.createElement('div');
    div.className = 'leg-item';
    div.innerHTML = `<span>${leg.label || leg.destLabel}</span>`;
    const btnRow = document.createElement('div');
    const renameBtn = document.createElement('button');
    renameBtn.className = 'ghost-btn small';
    renameBtn.textContent = '✏️';
    renameBtn.title = 'Rename';
    renameBtn.onclick = () => {
      const name = window.prompt('Name for this saved leg:', leg.label || leg.destLabel || '');
      if (name === null) return; // cancelled
      leg.label = name.trim() || null;
      saveTrip(state.trip);
      renderLegsList();
    };
    const goBtn = document.createElement('button');
    goBtn.className = 'ghost-btn small';
    goBtn.textContent = 'Use as destination';
    goBtn.onclick = () => {
      state.pendingDest = { lat: leg.destLat, lon: leg.destLon, label: leg.destLabel };
      document.getElementById('destInput').value = leg.destLabel;
      document.getElementById('destResults').innerHTML = '';
      refreshCalcButton();
    };
    const delBtn = document.createElement('button');
    delBtn.className = 'ghost-btn small';
    delBtn.textContent = 'Delete';
    delBtn.onclick = () => {
      state.trip.legs = state.trip.legs.filter((l) => l.id !== leg.id);
      saveTrip(state.trip);
      renderLegsList();
    };
    btnRow.appendChild(renameBtn);
    btnRow.appendChild(goBtn);
    btnRow.appendChild(delBtn);
    div.appendChild(btnRow);
    el.appendChild(div);
  });
}

function layerBadge(layer) {
  if (layer === 'address' || layer === 'venue') return '<span class="badge good">Exact</span>';
  if (layer === 'street') return '<span class="badge warn">Street only</span>';
  if (layer === 'postalcode') return '<span class="badge warn">ZIP area</span>';
  if (layer === 'locality' || layer === 'localadmin' || layer === 'borough' || layer === 'neighbourhood') return '<span class="badge warn">City area</span>';
  if (layer === 'region' || layer === 'county' || layer === 'macroregion') return '<span class="badge bad">Region only</span>';
  return '';
}

// Draggable-pin "fine-tune" map shown after picking a search result, so
// imprecise geocoding (e.g. an address ORS's database doesn't have,
// falling back to a street/city-level point) can always be corrected by
// hand rather than silently leaving the route's start or end off-target.
function ensureFineTuneMap(key, lat, lon, onChange) {
  const containerId = key + 'FineTune';
  const mapDivId = key + 'FineTuneMap';
  const container = document.getElementById(containerId);
  container.classList.remove('hidden');
  const mapKey = key + 'FineMap';
  const markerKey = key + 'FineMarker';

  const setup = () => {
    if (!state[mapKey]) {
      const map = L.map(mapDivId, { zoomControl: false, attributionControl: false }).setView([lat, lon], 17);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
      const marker = L.marker([lat, lon], { draggable: true }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); onChange(p.lat, p.lng); });
      map.on('click', (e) => { marker.setLatLng(e.latlng); onChange(e.latlng.lat, e.latlng.lng); });
      state[mapKey] = map;
      state[markerKey] = marker;
    } else {
      state[mapKey].invalidateSize();
      state[mapKey].setView([lat, lon], 17);
      state[markerKey].setLatLng([lat, lon]);
    }
  };
  // Give the container a moment to actually become visible/sized before
  // Leaflet measures it, otherwise tiles render into a zero-size box.
  setTimeout(setup, 0);
}

function wireSetupScreen() {
  const destInput = document.getElementById('destInput');
  const destResults = document.getElementById('destResults');
  const startInput = document.getElementById('startInput');
  const startResults = document.getElementById('startResults');
  const manualStartBtn = document.getElementById('manualStartBtn');
  const calcBtn = document.getElementById('calcRouteBtn');
  const errEl = document.getElementById('setupError');

  const searchDest = debounce(async (text) => {
    if (!text || text.length < 3) { destResults.innerHTML = ''; return; }
    try {
      const results = await orsGeocode(text);
      destResults.innerHTML = results.map((r, i) =>
        `<div class="result-item" data-i="${i}">${r.label} ${layerBadge(r.layer)}</div>`).join('');
      Array.from(destResults.children).forEach((child, i) => {
        child.onclick = () => {
          state.pendingDest = results[i];
          Array.from(destResults.children).forEach((c) => c.classList.remove('selected'));
          child.classList.add('selected');
          refreshCalcButton();
          ensureFineTuneMap('dest', results[i].lat, results[i].lon, (lat, lon) => {
            state.pendingDest.lat = lat;
            state.pendingDest.lon = lon;
          });
        };
      });
    } catch (e) {
      errEl.textContent = e.message;
    }
  }, 450);
  destInput.addEventListener('input', (e) => {
    state.pendingDest = null;
    document.getElementById('destFineTune').classList.add('hidden');
    refreshCalcButton();
    const coords = parseLatLon(e.target.value);
    if (coords) {
      state.pendingDest = { lat: coords.lat, lon: coords.lon, label: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` };
      destResults.innerHTML = `<div class="result-item selected">📍 Using coordinates ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)} — drag the pin below to fine-tune if needed.</div>`;
      refreshCalcButton();
      ensureFineTuneMap('dest', coords.lat, coords.lon, (lat, lon) => {
        state.pendingDest.lat = lat;
        state.pendingDest.lon = lon;
      });
      return;
    }
    const gmaps = parseGoogleMapsUrl(e.target.value);
    if (gmaps) {
      if (gmaps.shortLink) {
        destResults.innerHTML = `<div class="result-item">That's a shortened Google Maps link — open it once in any browser tab first (it'll turn into a longer google.com/maps/... link), then paste that one here instead.</div>`;
        return;
      }
      state.pendingDest = { lat: gmaps.lat, lon: gmaps.lon, label: gmaps.label };
      destResults.innerHTML = `<div class="result-item selected">📍 ${escapeHtml(gmaps.label)} (from Google Maps link) — drag the pin below to fine-tune if needed.</div>`;
      refreshCalcButton();
      ensureFineTuneMap('dest', gmaps.lat, gmaps.lon, (lat, lon) => {
        state.pendingDest.lat = lat;
        state.pendingDest.lon = lon;
      });
      return;
    }
    searchDest(e.target.value);
  });

  const searchStart = debounce(async (text) => {
    if (!text || text.length < 3) { startResults.innerHTML = ''; return; }
    try {
      const results = await orsGeocode(text);
      startResults.innerHTML = results.map((r, i) =>
        `<div class="result-item" data-i="${i}">${r.label} ${layerBadge(r.layer)}</div>`).join('');
      Array.from(startResults.children).forEach((child, i) => {
        child.onclick = () => {
          state.manualStart = results[i];
          state.manualStartEditing = false;
          startInput.value = results[i].label;
          startResults.innerHTML = '';
          refreshCalcButton();
          ensureFineTuneMap('start', results[i].lat, results[i].lon, (lat, lon) => {
            state.manualStart.lat = lat;
            state.manualStart.lon = lon;
          });
        };
      });
    } catch (e) {
      errEl.textContent = e.message;
    }
  }, 450);

  manualStartBtn.addEventListener('click', () => {
    state.manualStart = null;
    state.manualStartEditing = true; // blocks GPS fixes from overwriting the field while typing — see updateSetupStartLabel()
    startInput.disabled = false;
    startInput.value = '';
    startInput.placeholder = 'Type a starting address…';
    startInput.focus();
    document.getElementById('startFineTune').classList.add('hidden');
  });
  startInput.addEventListener('input', (e) => {
    document.getElementById('startFineTune').classList.add('hidden');
    const coords = parseLatLon(e.target.value);
    if (coords) {
      state.manualStart = { lat: coords.lat, lon: coords.lon, label: `${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)}` };
      state.manualStartEditing = false;
      startResults.innerHTML = `<div class="result-item selected">📍 Using coordinates ${coords.lat.toFixed(5)}, ${coords.lon.toFixed(5)} — drag the pin below to fine-tune if needed.</div>`;
      refreshCalcButton();
      ensureFineTuneMap('start', coords.lat, coords.lon, (lat, lon) => {
        state.manualStart.lat = lat;
        state.manualStart.lon = lon;
      });
      return;
    }
    const gmaps = parseGoogleMapsUrl(e.target.value);
    if (gmaps) {
      if (gmaps.shortLink) {
        startResults.innerHTML = `<div class="result-item">That's a shortened Google Maps link — open it once in any browser tab first (it'll turn into a longer google.com/maps/... link), then paste that one here instead.</div>`;
        return;
      }
      state.manualStart = { lat: gmaps.lat, lon: gmaps.lon, label: gmaps.label };
      state.manualStartEditing = false;
      startResults.innerHTML = `<div class="result-item selected">📍 ${escapeHtml(gmaps.label)} (from Google Maps link) — drag the pin below to fine-tune if needed.</div>`;
      refreshCalcButton();
      ensureFineTuneMap('start', gmaps.lat, gmaps.lon, (lat, lon) => {
        state.manualStart.lat = lat;
        state.manualStart.lon = lon;
      });
      return;
    }
    searchStart(e.target.value);
  });

  calcBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    const start = getStartCoords();
    const dest = state.pendingDest;
    if (!start || !dest) { errEl.textContent = 'Set both a starting point and a destination.'; return; }
    calcBtn.disabled = true;
    calcBtn.textContent = 'Calculating route…';
    try {
      const route = await calcRouteWithPreference(start, dest);
      route.destForReroute = dest;
      state.route = route;
      state.currentStepIndex = 0;
      nearestIndexCache = 0; // fresh route array — see performReroute()'s comment
      state.lastRerouteAt = 0;
      state.rerouteOfferState = 'none';
      state.rerouteOffer = null;
      state.announced = new Set();
      state.arrivalAnnounced = false;

      const legLabel = document.getElementById('legLabelInput').value.trim();
      state.currentLegLabel = legLabel || null;
      const leg = {
        id: 'leg_' + Date.now(),
        label: legLabel || null,
        destLabel: dest.label,
        destLat: dest.lat, destLon: dest.lon,
        createdAt: Date.now(),
      };
      state.trip.legs.push(leg);
      saveTrip(state.trip);
      persistActiveLeg(); // safety net — see LS_ACTIVE_LEG / checkForActiveLeg()

      document.getElementById('setupScreen').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      if (!state.map) initMap();
      // Fresh leg: start back in auto-follow, even if a previous leg was
      // left manually panned away.
      state.followMe = true;
      if (state.recenterBtnDiv) state.recenterBtnDiv.classList.add('hidden');
      drawRoute();
      onLocationUpdate();
      renderSharePanel();
      requestNavWakeLock();
      updateEndLegButtonLabel(); // resets to the plain wording — state.itinerary is null outside a trip plan
      const choiceMsg = describeRouteChoice(route);
      if (choiceMsg) toast(choiceMsg, 6000);
    } catch (e) {
      errEl.textContent = friendlyRouteError(e, start, dest);
    } finally {
      calcBtn.disabled = false;
      calcBtn.textContent = 'Calculate Route';
    }
  });

  document.getElementById('addStopBtn').addEventListener('click', addStopToPlan);
  document.getElementById('clearTripPlanBtn').addEventListener('click', clearTripPlan);
  document.getElementById('calcTripPlanBtn').addEventListener('click', calculateTripPlan);

  renderLegsList();
  renderTripPlanUI();
  refreshCalcButton();
}

/* ============================== SETTINGS MODAL ============================== */

function wireSettingsModal() {
  const modal = document.getElementById('settingsModal');
  const openBtn = document.getElementById('settingsBtn');
  const closeBtn = document.getElementById('closeSettingsBtn');
  const saveBtn = document.getElementById('saveSettingsBtn');
  const orsInput = document.getElementById('orsKeyInput');
  const rangeInput = document.getElementById('rangeInput');
  const breakInput = document.getElementById('breakInput');
  const locDeviceRadio = document.getElementById('locSourceDevice');
  const locRelayRadio = document.getElementById('locSourceRelay');
  const relayUrlRow = document.getElementById('relayUrlRow');
  const relayUrlInput = document.getElementById('relayUrlInput');
  const routePrefFastestRadio = document.getElementById('routePrefFastest');
  const routePrefBalancedRadio = document.getElementById('routePrefBalanced');
  const routePrefAvoidRadio = document.getElementById('routePrefAvoid');
  const backRoadsToleranceRow = document.getElementById('backRoadsToleranceRow');
  const backRoadsToleranceInput = document.getElementById('backRoadsToleranceInput');
  const rerouteAskRadio = document.getElementById('rerouteModeAsk');
  const rerouteAutoRadio = document.getElementById('rerouteModeAuto');

  function syncRelayRowVisibility() {
    relayUrlRow.classList.toggle('hidden', !locRelayRadio.checked);
  }
  function syncToleranceRowVisibility() {
    backRoadsToleranceRow.classList.toggle('hidden', !routePrefBalancedRadio.checked);
  }
  function checkedRoutePrefRadio() {
    if (routePrefBalancedRadio.checked) return 'balanced';
    if (routePrefAvoidRadio.checked) return 'avoid-highways';
    return 'fastest';
  }

  function openModal() {
    orsInput.value = state.settings.orsKey || '';
    rangeInput.value = state.settings.rangeMiles || '';
    breakInput.value = state.settings.breakMinutes != null ? state.settings.breakMinutes : 120;
    (state.settings.locationSource === 'relay' ? locRelayRadio : locDeviceRadio).checked = true;
    relayUrlInput.value = state.settings.relayUrl || '';
    syncRelayRowVisibility();
    const pref = state.settings.routePreference || 'fastest';
    routePrefFastestRadio.checked = pref === 'fastest';
    routePrefBalancedRadio.checked = pref === 'balanced';
    routePrefAvoidRadio.checked = pref === 'avoid-highways';
    backRoadsToleranceInput.value = state.settings.backRoadsToleranceMinutes != null ? state.settings.backRoadsToleranceMinutes : 15;
    syncToleranceRowVisibility();
    (state.settings.rerouteMode === 'auto' ? rerouteAutoRadio : rerouteAskRadio).checked = true;
    modal.classList.remove('hidden');
  }
  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  locDeviceRadio.addEventListener('change', syncRelayRowVisibility);
  locRelayRadio.addEventListener('change', syncRelayRowVisibility);
  routePrefFastestRadio.addEventListener('change', syncToleranceRowVisibility);
  routePrefBalancedRadio.addEventListener('change', syncToleranceRowVisibility);
  routePrefAvoidRadio.addEventListener('change', syncToleranceRowVisibility);

  saveBtn.addEventListener('click', () => {
    state.settings.orsKey = orsInput.value.trim();
    state.settings.rangeMiles = rangeInput.value ? parseFloat(rangeInput.value) : null;
    state.settings.breakMinutes = breakInput.value ? parseInt(breakInput.value, 10) : 0;
    const newLocationSource = locRelayRadio.checked ? 'relay' : 'device';
    const newRelayUrl = relayUrlInput.value.trim();
    const locationSettingChanged = newLocationSource !== state.settings.locationSource || newRelayUrl !== state.settings.relayUrl;
    state.settings.locationSource = newLocationSource;
    state.settings.relayUrl = newRelayUrl;
    state.settings.routePreference = checkedRoutePrefRadio();
    state.settings.backRoadsToleranceMinutes = backRoadsToleranceInput.value ? parseInt(backRoadsToleranceInput.value, 10) : 0;
    state.settings.rerouteMode = rerouteAutoRadio.checked ? 'auto' : 'ask';
    saveSettings(state.settings);
    modal.classList.add('hidden');
    refreshCalcButton();
    updateFuelPanel();
    toast('Settings saved.', 3000);
    if (locationSettingChanged) startLocationSource();
  });

  if (!state.settings.orsKey) {
    setTimeout(openModal, 400);
  }
}

/* ============================== VOICE CONTROLS WIRING ============================== */

function wireVoiceControls() {
  const enableBtn = document.getElementById('enableVoiceBtn');
  const toggleBtn = document.getElementById('voiceToggleBtn');

  if (!voiceSupported()) {
    enableBtn.textContent = 'Voice guidance not supported in this browser';
    enableBtn.disabled = true;
    toggleBtn.classList.add('hidden');
    return;
  }

  if (state.settings.voiceEnabled) {
    enableBtn.textContent = '✓ Voice Guidance Enabled';
  }

  enableBtn.addEventListener('click', () => {
    unlockVoice();
    state.settings.voiceEnabled = true;
    saveSettings(state.settings);
    enableBtn.textContent = '✓ Voice Guidance Enabled';
    updateVoiceButtons();
    toast('Voice guidance enabled.', 3000);
    // Speak an actual, audible confirmation right now — tapping this
    // button used to only flip a setting, so "enabled" could mean anything
    // from working fine to permanently silent, and there was no way to
    // tell which until a turn came up mid-drive. This catches that gap on
    // the spot, every time voice guidance is turned on from here.
    setTimeout(() => speak('Voice guidance enabled. You should hear turn announcements like this one.'), 300);
  });

  toggleBtn.addEventListener('click', () => {
    state.settings.voiceEnabled = !state.settings.voiceEnabled;
    if (state.settings.voiceEnabled) unlockVoice();
    saveSettings(state.settings);
    updateVoiceButtons();
    toast(state.settings.voiceEnabled ? 'Voice guidance on.' : 'Voice guidance muted.', 2500);
    if (state.settings.voiceEnabled) setTimeout(() => speak('Voice guidance on.'), 300);
  });

  updateVoiceButtons();
}

/* ============================== END LEG ============================== */

function wireEndLeg() {
  document.getElementById('endLegBtn').addEventListener('click', () => {
    const it = state.itinerary;
    const hasMoreLegs = it && it.currentLegIdx + 1 < it.legs.length;

    // Mid-trip-plan, with more days already calculated: this button means
    // "I'm done driving for today," not "end the whole trip" — hand off to
    // the next day instead, keeping the same share link the whole way
    // through. See advanceToNextLeg().
    if (hasMoreLegs) {
      const next = it.legs[it.currentLegIdx + 1];
      const nextName = next.label || next.destLabel;
      const msg = `End Day ${it.currentLegIdx + 1} and move on to Day ${it.currentLegIdx + 2} (${nextName})?` +
        (state.share.active ? '\n\nYour shared link stays the same — family will just see you\'re taking a break until you\'re back on the road.' : '');
      if (!window.confirm(msg)) return;
      advanceToNextLeg();
      return;
    }

    // Confirm first — same reasoning as stopSharingBtn above: this ends
    // live sharing too (if it's on), and a stray tap here (reaching for
    // something else, a bump in the road) shouldn't be able to end a leg
    // with no way to catch it first.
    const msg = state.share.active
      ? 'End this leg and go back to planning the next one?\n\nThis also stops live sharing — family keeps access to the route, photos, and comments, just no more live position updates.'
      : 'End this leg and go back to planning the next one?';
    if (!window.confirm(msg)) return;
    if (state.share.active) stopSharing();
    state.route = null;
    state.itinerary = null;
    state.currentLegLabel = null;
    releaseNavWakeLock();
    clearActiveLeg(); // the leg is genuinely done — nothing to offer resuming later
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('setupScreen').classList.remove('hidden');
    document.getElementById('destInput').value = '';
    document.getElementById('legLabelInput').value = '';
    state.pendingDest = null;
    // Reset back to live GPS for the next leg — otherwise a manual start
    // set once (e.g. planning tonight's leg from a hotel) would silently
    // keep being used forever, for every leg after this one too, since
    // nothing else ever clears it. The very next leg almost always starts
    // from wherever you physically are now, which live GPS already knows.
    state.manualStart = null;
    state.manualStartEditing = false;
    const startInputEl = document.getElementById('startInput');
    startInputEl.disabled = true;
    updateSetupStartLabel();
    updateEndLegButtonLabel();
    renderLegsList();
    refreshCalcButton();
    checkForActiveLeg(); // hide the resume banner, if it was showing
  });
}

/* ============================== RESUME AN INTERRUPTED LEG ============================== */
// The other half of persistActiveLeg()/LS_ACTIVE_LEG — offered on the setup
// screen at startup whenever there's a saved snapshot, which is exactly
// the case after the app/browser gets fully closed mid-leg (overnight at a
// hotel being the main one, but this covers any interruption the same
// way: a crash, a restarted phone, low battery, etc).

function checkForActiveLeg() {
  const banner = document.getElementById('resumeLegBanner');
  const snap = loadActiveLeg();
  renderMyTripsList();
  if (!snap || !snap.route) { banner.classList.add('hidden'); return; }
  document.getElementById('resumeLegDest').textContent = snap.legLabel || snap.destLabel || 'your destination';
  banner.classList.remove('hidden');
  document.getElementById('resumeLegBtn').onclick = () => resumeActiveLeg(snap);
  document.getElementById('discardLegBtn').onclick = () => {
    clearActiveLeg();
    banner.classList.add('hidden');
  };
}

// Lets you pull a past leg's shared trip log (photos, comments, the route
// it followed) back up after you've ended it — the same view family got
// from your link, including the same Save/Download and Share buttons on
// every photo, since this reuses the exact same watch screen. Every pin
// you've ever shared under gets remembered locally (loadOwnTrips(), via
// rememberOwnTrip() in startSharing()) purely so cleanupExpiredMedia()
// knew what to check on — this is just putting that same list to a second,
// user-facing use. Collapsed by default (a real trip can rack up a lot of
// legs) — the summary line names how many without needing to open it.
//
// This index is local to this one browser only — nothing is stored about
// it in Firestore. That's normally invisible, but it means a couple of
// things can wipe it clean even though the actual trip logs it points to
// (photos, comments, routes) are completely untouched and still sit safely
// in Firestore exactly as before: clearing this site's browser data (the
// fallback suggested for the update-cache bug fixed in v2026.09.17.7),
// switching phones, or opening the app in a different browser/profile.
// Rather than just showing an empty list with no way back in that case,
// the panel always stays visible (never hides itself at zero) and offers
// a manual "already have a passcode" box — anyone who still has an old
// share link or passcode (checking sent texts to family is the easiest
// way) can paste the code back in here to get it listed again.
function renderMyTripsList() {
  const panel = document.getElementById('myTripsPanel');
  const el = document.getElementById('myTripsList');
  const summary = document.getElementById('myTripsSummary');
  if (!panel || !el) return;
  panel.classList.remove('hidden');
  const trips = loadOwnTrips().slice().reverse(); // most recent first
  if (summary) summary.textContent = trips.length ? `Show past legs (${trips.length})` : 'Show past legs';
  el.innerHTML = trips.length
    ? trips.map((t) => {
        const when = new Date(t.startedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        const title = t.label ? escapeHtml(t.label) + ` <span class="muted" style="font-size:12px;">${escapeHtml(when)} ·` : `${escapeHtml(when)} <span class="muted" style="font-size:12px;">`;
        return `<div class="leg-item">
          <span>${title} passcode ${escapeHtml(t.pin)}</span></span>
          <div style="display:flex;gap:4px;">
            <button type="button" class="ghost-btn small view-my-trip-btn" data-pin="${escapeHtml(t.pin)}">👀 View</button>
            <button type="button" class="ghost-btn small rename-my-trip-btn" data-pin="${escapeHtml(t.pin)}" title="Rename">✏️</button>
            <button type="button" class="ghost-btn small delete-my-trip-btn" data-pin="${escapeHtml(t.pin)}" title="Remove from this list">🗑</button>
          </div>
        </div>`;
      }).join('')
    : '<div class="muted" style="padding:4px 0 10px;">Nothing remembered on this device yet. If you have an old passcode or share link handy, add it below to get it listed again.</div>';
  el.querySelectorAll('.view-my-trip-btn').forEach((btn) => {
    btn.addEventListener('click', () => watchTripFromLink(btn.dataset.pin));
  });
  el.querySelectorAll('.rename-my-trip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pin = btn.dataset.pin;
      const current = loadOwnTrips().find((t) => t.pin === pin);
      const name = window.prompt('Name for this trip/leg (leave blank to clear):', (current && current.label) || '');
      if (name === null) return; // cancelled
      renameOwnTrip(pin, name.trim());
      renderMyTripsList();
    });
  });
  el.querySelectorAll('.delete-my-trip-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pin = btn.dataset.pin;
      if (!window.confirm('Remove this from "My past trip logs" on this device?\n\nThe trip log itself (photos, comments, route) is not deleted and can still be viewed by passcode — this only tidies up this list.')) return;
      forgetOwnTrip(pin);
      renderMyTripsList();
      toast('Removed from My past trip logs.', 2500);
    });
  });
}

// Manual recovery path for the local-only index described above: pastes a
// passcode (or a whole share link — anything with a 6-digit code in it)
// back into "My past trip logs" without needing to actually reconnect as
// the owner. Doesn't verify the trip still exists before adding it — an
// invalid/expired one just shows "No trip found" when actually viewed,
// same as typing a bad passcode into "Watch someone else's shared trip"
// always has.
function wireMyTripsAdd() {
  const btn = document.getElementById('addKnownPinBtn');
  const input = document.getElementById('addKnownPinInput');
  if (!btn || !input) return;
  const submit = () => {
    const m = input.value.match(/(\d{6})/);
    if (!m) { toast('Enter the 6-digit passcode (or paste the whole share link).', 4000); return; }
    rememberOwnTrip(m[1]);
    input.value = '';
    renderMyTripsList();
    toast('Added to My past trip logs.', 2500);
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
}

async function resumeActiveLeg(snap) {
  state.route = snap.route;
  state.currentLegLabel = snap.legLabel || null;
  state.itinerary = snap.itinerary || null;
  state.currentStepIndex = 0;
  nearestIndexCache = 0; // fresh route array — see performReroute()'s comment
  state.lastRerouteAt = 0;
  state.rerouteOfferState = 'none';
  state.rerouteOffer = null;
  state.announced = new Set();
  state.arrivalAnnounced = false;
  // A fresh page load (which is what "Resume Trip" always follows — see
  // GEO_TRACK_STORAGE_KEY's comment above) would otherwise silently adopt
  // wherever this GPS fix lands as your starting state/city/time zone, with
  // no announcement — including in the specific case this exists for: the
  // reload happened mid-drive (e.g. triggered by opening the phone's camera
  // to take a photo) right as you crossed a line. Restoring what was last
  // confirmed before the reload lets that crossing still get caught and
  // announced once you've driven a bit further.
  restoreConfirmedGeoTracking();

  document.getElementById('resumeLegBanner').classList.add('hidden');
  document.getElementById('setupScreen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  if (!state.map) initMap();
  state.followMe = true;
  if (state.recenterBtnDiv) state.recenterBtnDiv.classList.add('hidden');
  drawRoute();
  onLocationUpdate();
  requestNavWakeLock();
  updateEndLegButtonLabel();

  if (snap.pin) {
    await resumeSharing(snap.pin);
  }
  renderSharePanel();
  toast('Trip resumed — picking up right where you left off.', 4000);
}

// Reconnects to a trip document a previous (now-gone) session was sharing,
// under the exact same passcode/link, instead of starting a new one —
// that's the whole point: family never has to be sent a new link just
// because your phone's browser got closed overnight.
async function resumeSharing(pin) {
  // Same automatic-retry reasoning as startSharing() — see
  // SHARE_CONNECT_RETRIES's comment.
  let lastError = null;
  for (let attempt = 1; attempt <= SHARE_CONNECT_RETRIES + 1; attempt++) {
    try {
      const { db, uid } = await initFirebase();
      const docSnap = await withTimeout(db.collection('trips').doc(pin).get(), FIREBASE_CONNECT_TIMEOUT_MS, "Couldn't connect (looking up trip) — check your signal and try again.");
      if (!docSnap.exists || docSnap.data().ownerUid !== uid) {
        toast("Couldn't reconnect the share link from before — tap Start Sharing for a new one.", 6000);
        return;
      }
      await withTimeout(db.collection('trips').doc(pin).set({
        active: true, paused: false, pausedAt: null,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      }, { merge: true }), FIREBASE_CONNECT_TIMEOUT_MS, "Couldn't connect (reconnecting trip) — check your signal and try again.");
      state.share.active = true;
      state.share.pin = pin;
      state.share.ownerUid = uid;
      state.share.paused = false;
      state.share.pausedAt = 0;
      state.share.pausedLoc = null;
      state.share.lastPushAt = 0;
      state.share.lastPushLoc = null;
      state.share.viewerCount = 0;
      // No rememberOwnTrip() here — this is reconnecting to a pin that was
      // already recorded when it was first created in startSharing(), not a
      // new trip. Calling it again here (a bug fixed in v2026.09.17.6) was
      // adding a fresh duplicate entry to "My past trip logs" every single
      // time a leg got resumed — e.g. after any app-update reload — which is
      // exactly why that list could balloon to several entries in one day
      // despite only ever actually starting sharing once or twice.
      subscribeOwnEvents(pin);
      subscribeViewerCount(pin);
      subscribeViewerMessages(pin);
      renderViewerMessages();
      return;
    } catch (e) {
      lastError = e;
      if (attempt <= SHARE_CONNECT_RETRIES) { await sleep(2500); continue; }
    }
  }
  toast("Couldn't reconnect sharing: " + lastError.message, 6000);
}

/* ============================== CONTEXT-SENSITIVE HELP ============================== */

// One entry per "?" button in the app (data-help="<key>" on the button, or
// the topic name passed to addMapHelpControl()/currentHelpTopicForScreen()).
// Keeping these all in one place makes it easy to keep the wording in sync
// with README.md and with each other.
const HELP_TOPICS = {
  'setup-overview': {
    title: 'Planning a leg',
    html: `
      <p>A <b>leg</b> is one stretch of the trip — from wherever you start to one
      destination. Plan a new leg here before each drive.</p>
      <ul>
        <li><b>Starting point</b> defaults to your phone's live GPS. Tap "Set
        manually" to use a different spot instead (handy for planning ahead
        before you're actually there).</li>
        <li><b>Destination</b> accepts a typed address/city with autocomplete,
        or raw coordinates like <code>34.5625, -112.2867</code> for spots with
        no address.</li>
        <li><b>Label this leg</b> is just for your own reference in the saved
        legs list below.</li>
        <li>Tap <b>Calculate Route</b> once a destination is set to head to
        the dashboard.</li>
        <li><b>👀 Watch someone else's shared trip</b> is for when you're the
        one receiving a trip link/passcode, not planning your own.</li>
        <li>Prefer back roads over the interstate? <b>Settings → Route
        preference</b> can favor back roads whenever it's not much slower,
        or avoid highways entirely — applies here, to automatic rerouting,
        and to tap-anywhere-for-ETA.</li>
      </ul>
      <p>Tap the <b>?</b> next to any field above for more detail on that one.</p>`,
  },
  'trip-plan': {
    title: 'Multi-day Trip Plan',
    html: `
      <p>Planning several overnight stops? Use this to line up the whole
      trip in one sitting, before you drive, instead of planning one leg a
      day.</p>
      <ul>
        <li>Set a <b>Destination</b> above for the first overnight stop,
        then tap <b>➕ Add as a stop</b> instead of Calculate Route. Repeat
        for each additional day — each new stop automatically starts from
        the one before it.</li>
        <li>The list below shows every day queued up so far; tap 🗑 on any
        row to remove it.</li>
        <li>Once every day is queued, tap <b>Calculate & Start Trip Plan</b>.
        This works out the route for all of them and starts you on Day 1 —
        the other days wait until you get there.</li>
        <li>If you start sharing, family sees the <b>entire</b> planned
        route and every overnight stop right away, not just today's — see
        their side's Trip Plan help for what that looks like.</li>
        <li>At the end of each day, use <b>End Day / Continue</b> (the End
        Leg button relabels itself once a plan is running) to hand off to
        the next day under the exact same share link — no new passcode
        needed.</li>
        <li>Changed your mind? <b>Clear</b> empties the queued list so you
        can start over, or just plan a single leg as usual instead.</li>
      </ul>`,
  },
  'resume-banner': {
    title: 'Resume Trip banner',
    html: `
      <p>This shows up if you had a route/leg in progress that never got a
      proper <b>End Leg</b> — most likely because the app or browser got
      fully closed (very possible after 8+ hours backgrounded overnight).</p>
      <p>Tap <b>▶ Resume Trip</b> to pick the exact same route back up,
      including reconnecting your existing share link if you were sharing —
      nobody needs a new link. Tap <b>Discard</b> if that leg is done and you
      don't want it back.</p>`,
  },
  'start-point': {
    title: 'Starting point',
    html: `
      <p>By default this uses your phone's live GPS position the moment you
      calculate the route — you don't need to type anything.</p>
      <p>Tap <b>Set manually</b> to search for a different starting spot
      instead (for example, planning tomorrow's leg tonight from home). You
      can drag the pin afterward to fine-tune it, or type coordinates
      directly if the spot has no address.</p>
      <p>Search here comes from OpenStreetMap, so it's great for addresses
      and well-known chains but can miss small local businesses and doesn't
      understand street intersections ("Main St & Gurley St"). For either of
      those, find the spot in Google Maps instead and paste its link
      straight into this box (a long <code>google.com/maps/...</code> link —
      a short share-sheet link needs opening once in a browser first to
      expand it) and it'll drop the pin exactly there.</p>`,
  },
  destination: {
    title: 'Destination',
    html: `
      <p>Type an address, city, or landmark name and pick from the
      suggestions — you can drag the pin afterward if it's not exactly
      right.</p>
      <p>No address for the spot (a trailhead, campsite, backcountry
      turnoff)? Type coordinates straight in instead, like
      <code>34.5625, -112.2867</code> or <code>34.5625° N, 112.2867° W</code>
      — the app recognizes it immediately, no search needed.</p>
      <p>Search here comes from OpenStreetMap, so it's great for addresses
      and well-known chains but can miss small local businesses and doesn't
      understand street intersections ("Main St & Gurley St"). For either of
      those, find the spot in Google Maps instead and paste its link
      straight into this box (a long <code>google.com/maps/...</code> link —
      a short share-sheet link needs opening once in a browser first to
      expand it) and it'll drop the pin exactly there.</p>`,
  },
  'saved-legs': {
    title: 'Saved legs',
    html: `
      <p>Every leg you calculate is saved here automatically so you can
      re-run it later without re-entering the destination — handy for a
      route you plan more than once, or want to double check before you
      actually drive it.</p>`,
  },
  'my-trips': {
    title: 'My past trip logs',
    html: `
      <p>Every leg you've ever shared shows up here, most recent first —
      tap <b>👀 View</b> to pull one back up any time, even long after
      you've ended that leg. It opens the exact same screen family sees
      from your share link: the route you drove, every photo and comment,
      and the same <b>⬇ Save</b> / <b>📤 Share</b> buttons on each photo, so
      you never need to remember a passcode or re-send a link just to grab
      a picture you took earlier in the trip.</p>
      <p>Ending a leg only stops the live position updates — it never
      deletes the trip log itself, so this list keeps working for the
      whole trip. Photos do auto-expire after 90 days to keep Firestore's
      free tier happy (comments and video links never expire), which is
      well past any trip this app was built for.</p>
      <p>Collapsed by default since a real trip can rack up a lot of
      legs — tap "Show past legs" to expand it. One entry gets added each
      time you tap Start Sharing for a genuinely new leg; reconnecting to
      one already in progress (like resuming after a reload) reuses its
      existing entry rather than adding another.</p>
      <p>Forgot to give a leg a name when you set it up? Tap <b>✏️</b> on
      any entry to name (or rename) it any time — it'll show that name
      here instead of just the date. Tap <b>🗑</b> to remove an entry you
      don't need cluttering the list anymore; that only tidies up this
      device's list, it doesn't touch the actual trip log, so you can
      always add the passcode back later if you want it again.</p>
      <p>This list only lives in this browser, not in the cloud — so
      clearing this site's browser data, switching phones, or opening the
      app somewhere else starts it empty again, even though every trip it
      pointed to is completely unaffected and still sitting in Firestore
      exactly as it was. If that happens, paste an old passcode or share
      link into the box at the bottom (checking texts you sent family is
      the easiest way to find one) to add it back to the list.</p>`,
  },
  'dashboard-overview': {
    title: 'The drive dashboard',
    html: `
      <p>This is your live view while driving a calculated leg.</p>
      <ul>
        <li>The banner at the top gives your next turn; below that, a
        <b>Trip progress</b> bar (<b>?</b> for details) shows how far
        through the whole leg you are; the row below that shows miles left,
        ETA (with a date if it won't arrive today), speed, and
        elevation.</li>
        <li>Tap anywhere on the map to see the drive time/ETA to that spot —
        on your route or off it entirely.</li>
        <li>While you're sharing, a <b>💬 Messages from Family</b> panel
        appears right below the map for messages sent from a viewer's
        screen — read aloud automatically too.</li>
        <li>The sections below (Fuel, Weather, Alerts, Stops, Mountains,
        Daylight, Drive Timer, full directions, and Share &amp; Trip Log)
        each have their own <b>?</b> for details.</li>
        <li><b>🏁 End This Leg / Plan Next Leg</b> wraps up this leg and
        takes you back to planning the next one — asks you to confirm
        first, so a stray tap (a bump in the road, reaching for something
        else) can't end it by accident.</li>
      </ul>`,
  },
  'trip-progress': {
    title: 'Trip progress',
    html: `
      <p>A simple visual of how far through this leg you are: the
      percentage and mileage are miles driven so far out of the leg's total
      distance, based on the same route data everything else on this screen
      uses.</p>
      <p>Family watching your shared trip see this exact same bar on their
      screen, worked out from the route and position you're already sharing
      with them — no extra setup needed.</p>`,
  },
  'map-driver': {
    title: 'Using the map',
    html: `
      <ul>
        <li>The map follows your position automatically as you drive; drag
        it to look around and a <b>⌖ Recenter</b> button appears to snap
        back.</li>
        <li><b>Tap anywhere</b> — a town ahead, a detour, anywhere — to see
        the drive distance/time and a clock ETA to that exact spot, plus the
        elevation there and the current weather. This runs a fresh
        calculation each time and never changes your actual route.</li>
        <li>The button in the top-right cycles Satellite/Street/Auto (Auto
        switches based on your speed). Street mode is plain street-map
        tiles with street names built in; Satellite mode overlays road
        names and place names on top of the aerial imagery so you still get
        street names without losing the satellite view.</li>
        <li><b>⛶ Full Map</b> (top-left) expands the map to fill the
        screen.</li>
        <li>Dashed colored lines mark the boundaries between US time zones,
        each labeled — Eastern, Central, Mountain, Mountain (Arizona,
        which doesn't observe Daylight Saving Time), and Pacific. Crossing
        one pops up an alert and reads it aloud, telling you whether your
        clock actually needs to change right now (it sometimes doesn't,
        near Arizona, depending on the time of year).</li>
      </ul>`,
  },
  'reroute-offer': {
    title: 'Reroute offer',
    html: `
      <p>Shows up when you've drifted noticeably off the calculated route —
      by default it asks rather than just recalculating on its own, in case
      you took a different way on purpose (a detour, a stop that's not on
      the route, a shortcut you know about) and don't want it replanned out
      from under you.</p>
      <p>Tap <b>🔄 Reroute</b> to recalculate from wherever you are right
      now. Tap <b>Keep Going This Way</b> to dismiss it — it won't ask again
      for this same detour, but a small 🔄 button stays near the map the
      whole time you're off-route in case you change your mind. Getting
      back near the original route resets it, so the next detour asks
      fresh.</p>
      <p>Prefer it to just reroute automatically without asking? Settings →
      "When you go off the planned route" has that as an option too.</p>`,
  },
  'fuel-planner': {
    title: 'Fuel Planner',
    html: `
      <p>Set your vehicle's driving range (on a full tank) in Settings to
      turn this on. It flags when the nearest known gas station ahead is
      farther than about 80% of that range, so you get a heads-up before
      you'd be cutting it close.</p>
      <p>It has no idea what your actual fuel level is — it only compares
      distance-to-next-station against your range.</p>`,
  },
  'weather-ahead': {
    title: 'Weather Ahead',
    html: `
      <p>Forecasts from the National Weather Service (free, US only) at your
      current spot and two points further along your remaining route, each
      timed to when you're expected to actually be there.</p>`,
  },
  alerts: {
    title: 'Road & Weather Alerts',
    html: `
      <p>Active NWS alerts — winter storms, high wind, flooding, and similar
      — near your current spot and those same points ahead.</p>
      <p>There's no free, nationwide live-traffic-incident feed, so this is
      weather-based only, not accidents or road closures.</p>`,
  },
  'upcoming-stops': {
    title: 'Upcoming Stops',
    html: `
      <p>Named gas stations, restaurants, rest areas, viewpoints, and
      attractions within about 15 miles roughly ahead of you, from
      OpenStreetMap's free map data.</p>`,
  },
  'mountains-nearby': {
    title: 'Mountains Nearby',
    html: `
      <p>Named peaks with known elevation within about 40 miles of your
      current position, with distance and compass direction. The 6 closest
      are also pinned right on the map with an always-visible label.</p>
      <p>This is straight-line distance, not a guaranteed line-of-sight — a
      closer ridge could still be blocking your actual view of a listed
      peak.</p>`,
  },
  daylight: {
    title: 'Daylight',
    html: `
      <p>Sunrise/sunset times and hours of daylight left at your current
      location — handy for judging whether you'll reach a scenic stretch or
      campsite while it's still light out.</p>`,
  },
  'drive-timer': {
    title: 'Drive Timer',
    html: `
      <p>Tracks how long you've been driving continuously (based on GPS
      speed) and pops up a reminder once you hit the rest-break interval you
      set in Settings (0 turns it off).</p>`,
  },
  'turn-by-turn': {
    title: 'Full turn-by-turn',
    html: `
      <p>The complete list of directions for this leg, with the current step
      highlighted. Spoken prompts (once voice guidance is enabled) announce
      each turn about a mile ahead and again right before it.</p>`,
  },
  'share-trip-log': {
    title: 'Share & Trip Log',
    html: `
      <ul>
        <li>The trip's name sits at the top of this panel, with a
        <b>✏️</b> button next to it — tap it any time (before or after you
        start sharing) to set or change what family sees as the trip's
        title, on your screen and theirs. Leave it blank and it just shows
        as "Untitled trip" on your side; watchers simply won't see a title
        at all until you set one.</li>
        <li>Tap <b>Start Sharing This Leg</b> to get a one-tap link (plus a
        6-digit passcode as backup) for family. <b>📤 Share Link</b> sends it
        through your phone's own share sheet; <b>📋 Copy</b> copies it by
        hand.</li>
        <li>Whoever gets the link just taps it — no typing, no account,
        straight into watching your live position, photos, comments, and
        weather.</li>
        <li>Use 📷/🎥/💬 to drop a geotagged photo, video link, or comment —
        each is tagged with GPS coordinates, temperature, and elevation at
        that moment.</li>
        <li>🤖 Crossing a state line adds one of these automatically too —
        capital, population, GDP, bird, tree, flower, nickname, statehood
        date, and which party currently runs that state's government, about
        a mile past the line. It's tagged with a distinct amber icon so it's
        obviously not something you typed, spoken aloud once any turn
        instruction in progress finishes, and shows up for watchers exactly
        like your own comments do.</li>
        <li>🏙️ Driving into one of about 85 major US cities does the same
        thing with a blue icon instead — population, when it was
        incorporated, its primary industry, and the current mayor and
        party. Suburbs of a bigger neighboring city (Tempe/Mesa/Scottsdale
        near Phoenix, Henderson near Las Vegas, and so on) don't get their
        own separate announcement — only the main city does, even if your
        route runs straight through the suburb.</li>
        <li>🕐 Crossing into a new US time zone pops up an on-screen alert
        and speaks it aloud too — including whether your clock actually
        needs to change right now, since Arizona doesn't observe Daylight
        Saving Time and so sometimes matches Pacific and sometimes matches
        Mountain depending on the season. This one alerts you even when
        you're not sharing a leg; it's only added to the trip log (for
        watchers to see) while you are.</li>
        <li>Stopping overnight without ending the leg? Tap <b>⏸ Pause for
        the Night</b> so family sees a friendly "taking a break" message
        instead of a stale-data warning; it clears itself once you're
        driving again.</li>
        <li><b>👀 X watching now</b> only shows on your own screen, so you
        know if anyone actually has the trip open.</li>
        <li><b>Stop Sharing</b> only stops live position updates — the same
        link/passcode keeps working afterward for anyone to view the route,
        photos, and comments; see <b>My past trip logs</b> on the setup
        screen for how to pull it back up yourself. Asks you to confirm
        first, so a stray tap can't cut off live sharing by accident.</li>
      </ul>`,
  },
  'viewer-messages': {
    title: 'Messages from Family',
    html: `
      <p>Anyone watching your shared trip can send you a short message from
      their own screen — it shows up here, below the map, tagged with
      whatever name they typed in.</p>
      <p>It's also read aloud through voice guidance as soon as it arrives —
      unless a turn-by-turn instruction is actively being spoken at that
      moment, in which case it waits rather than talking over the turn; if
      voice is still busy after a few seconds it gives up on speaking that
      one, but it's always still sitting here in the panel to read.</p>
      <p>This only appears while you're actively sharing a leg — nobody has
      anyone to message otherwise.</p>
      <p>Each message has a <b>🎤 Reply</b> button — tap it, speak your
      answer, and it goes straight back to that one person (not everyone
      watching), read on their screen and shown as a reply there. Nothing
      to type; just tap, talk, and it's sent, with a short spoken
      confirmation so you don't need to look at the screen. If your browser
      doesn't support voice input, it falls back to a quick one-line text
      prompt instead.</p>`,
  },
  'watch-pin-overview': {
    title: 'Watching a trip',
    html: `
      <p>If you were sent a link, you shouldn't need this screen at all — the
      link opens you straight into watching. This screen is the fallback:
      type in the 6-digit passcode the traveler gave you and tap
      <b>Watch</b>.</p>
      <p>Nothing to install, no account needed — you'll see their live
      position, photos, comments, and weather update as they drive.</p>`,
  },
  'watch-live-overview': {
    title: 'Watching live',
    html: `
      <ul>
        <li>If the traveler has named this trip, that name shows in bold at
        the very top of this screen — they can change it any time, and
        it'll update here the next time this screen refreshes.</li>
        <li>The status line below that tells you if things are current, if
        the traveler is taking a break overnight (⏸ paused), or if updates
        have gone stale.</li>
        <li>Below that: a trip progress bar (percent of the total distance
        driven so far), then current weather and elevation at their
        position, then the live map — their position updates as an arrow
        pointing their direction of travel.</li>
        <li>Tap anywhere on the map for an estimated drive time from their
        current spot to that point (an estimate, not a live calculation —
        see the map's own <b>?</b> for why).</li>
        <li><b>💬 Send a message</b> right below the map reaches the
        traveler directly — it shows up on their dashboard and gets read
        aloud to them.</li>
        <li><b>⛰ Mountains Nearby</b> shows named peaks around their current
        position.</li>
        <li><b>📝 Trip Log</b> below the map lists every photo, video, and
        comment they've added, newest first.</li>
      </ul>`,
  },
  'watch-itinerary': {
    title: 'Trip Plan',
    html: `
      <p>Shows up only when the traveler built this as a multi-day <b>Trip
      Plan</b> (several overnight stops under one shared link) instead of a
      single leg — for an ordinary one-day trip this panel just isn't
      there.</p>
      <ul>
        <li>Lists every planned day, with 📍 marking the one currently being
        driven and ✅ marking days already finished.</li>
        <li>The map shows a lighter, dashed purple line for the whole
        planned trip, underneath the brighter solid line for today's
        driving, plus a 🌙 marker at each overnight stop and a 🏁 marker at
        the final destination — tap any marker for its name.</li>
        <li>That overview line and its markers are a snapshot from when the
        traveler calculated their plan — they won't shift if the traveler
        reroutes during today's drive (today's solid line still will).</li>
        <li>At the end of each day the traveler taps <b>End Day / Continue</b>
        rather than fully stopping — the same share link carries over to the
        next day automatically, so you'll keep watching without needing
        anything new from them.</li>
      </ul>`,
  },
  'map-watch': {
    title: 'Using this map',
    html: `
      <ul>
        <li>The map follows the traveler's live position automatically; drag
        it to look around and a <b>⌖ Recenter</b> button appears to snap
        back.</li>
        <li><b>Tap anywhere</b> to estimate the drive time from their
        current position to that spot. This is an estimate based on the
        route data already shared with you (you don't have your own routing
        key), so it's most accurate for a tap right on or very near their
        route line — it'll say so if your tap landed well off of it.</li>
        <li>The popup also shows elevation and current weather at the
        tapped spot. Elevation is an estimate from the nearest point on
        their shared route (same accuracy caveat as the ETA); weather is a
        live, exact lookup for that spot and loads in a moment after the
        rest of the popup appears.</li>
        <li>If the traveler reroutes mid-drive, the blue route line here
        updates to match within moments, with a quick note that it changed
        — you're never left watching their position drift away from a route
        they're no longer on.</li>
        <li>The "Hours to go" figure next to the update time is an estimate
        of remaining drive time, using the same shared route data as the
        tap-for-ETA feature above — most accurate while they're on or near
        their planned route.</li>
        <li>Dashed colored lines mark the boundaries between US time zones,
        each labeled, so you can see at a glance which zone the traveler is
        currently in and what's coming up.</li>
        <li>Road names and place names are overlaid right on the map, so
        you can see actual street names, not just a bare aerial photo.</li>
        <li>Tap the traveler's own marker (the arrow or car icon) for their
        current speed and direction of travel — it's tucked behind a tap
        instead of an always-visible label so it doesn't sit on top of the
        route or the marker itself.</li>
      </ul>`,
  },
  'watch-mountains': {
    title: 'Mountains Nearby',
    html: `
      <p>Named peaks with known elevation within about 40 miles of the
      traveler's current position, with distance and compass direction from
      them. Listed here only — no separate pins on the map — to keep the
      map itself readable.</p>
      <p>This is straight-line distance, not a guaranteed line-of-sight — a
      closer ridge could still block the actual view of a listed peak.</p>`,
  },
  'watch-events': {
    title: 'Trip Log',
    html: `
      <p>Every photo, video link, and comment the traveler has added along
      the way, newest first, each tagged with the GPS coordinates,
      temperature, and elevation at the moment it was added. Tap a photo to
      view it larger, or a video link to open it.</p>
      <p>You'll also see a 🤖 entry with an amber icon each time the
      traveler crosses into a new US state — that one's added automatically
      by the app, not typed by them, with that state's capital, population,
      GDP, bird, tree, flower, nickname, statehood date, and current
      government control.</p>
      <p>A 🏙️ entry with a blue icon means the same thing for one of about
      85 major US cities — population, when it was incorporated, its
      primary industry, and the current mayor and party. Suburbs of a
      bigger city (Tempe near Phoenix, Henderson near Las Vegas, etc.)
      don't get their own entry — only the main city does.</p>`,
  },
  'watch-send-message': {
    title: 'Send a message',
    html: `
      <p>Type your name once — this phone remembers it for next time — and
      whatever you want to say, then tap <b>Send</b>. It shows up right on
      the traveler's dashboard below their map, and gets read aloud to them
      through voice guidance too (unless they're mid-turn, in which case it
      waits so it doesn't talk over an actual turn instruction).</p>
      <p>They can reply — see <b>🚗 Reply from the Traveler</b> above this
      box — but only to whoever's message they tapped Reply on, so a reply
      shows up here only if the traveler actually replied to you
      specifically, not to someone else watching.</p>`,
  },
  'watch-replies': {
    title: 'Reply from the Traveler',
    html: `
      <p>When the traveler taps <b>🎤 Reply</b> on your message and speaks
      an answer, it shows up here, addressed to you specifically — nobody
      else watching sees it.</p>
      <p>This panel only appears once you've actually gotten a reply; no
      reply yet just means nothing to show.</p>`,
  },
};

function showHelp(topicId) {
  const topic = HELP_TOPICS[topicId];
  if (!topic) return;
  document.getElementById('helpTitle').textContent = topic.title;
  document.getElementById('helpBody').innerHTML = topic.html;
  document.getElementById('helpModal').classList.remove('hidden');
}

// The topbar's ❓ button doesn't point at one fixed topic — it looks at
// which top-level screen is currently visible and opens that screen's
// overview instead, so the same button is "context-sensitive" without the
// driver or a viewer having to know which per-section "?" to look for.
function currentHelpTopicForScreen() {
  if (!document.getElementById('setupScreen').classList.contains('hidden')) return 'setup-overview';
  if (!document.getElementById('dashboard').classList.contains('hidden')) return 'dashboard-overview';
  if (!document.getElementById('watchScreen').classList.contains('hidden')) {
    return document.getElementById('watchPinEntry').classList.contains('hidden') ? 'watch-live-overview' : 'watch-pin-overview';
  }
  return 'setup-overview';
}

function wireHelpSystem() {
  const modal = document.getElementById('helpModal');
  document.getElementById('closeHelpBtn').addEventListener('click', () => modal.classList.add('hidden'));
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.add('hidden'); }); // tap the dark backdrop to close
  document.getElementById('helpBtn').addEventListener('click', () => showHelp(currentHelpTopicForScreen()));

  // Delegated so every "?" button works — including ones inside dynamically
  // rendered markup — without wiring a listener to each one individually.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.help-btn');
    if (!btn) return;
    e.preventDefault();  // a "?" inside a <summary> would otherwise also toggle that <details>
    e.stopPropagation();
    showHelp(btn.dataset.help);
  });
}

// Small on-map control explaining that map's tap/drag gestures — shared by
// the driver's own map and a viewer's watch map, each pointed at its own
// topic since a viewer's tap-for-ETA is an estimate rather than a live
// calculation (see 'map-watch' above).
function addMapHelpControl(map, topicId) {
  const MapHelpControl = L.Control.extend({
    options: { position: 'bottomleft' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar map-toggle-btn');
      div.innerText = '❓ Help';
      div.title = 'What can I do with this map?';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div, 'click', () => showHelp(topicId));
      return div;
    },
  });
  return new MapHelpControl().addTo(map);
}

/* ============================== UPDATE CHECK ============================== */
// This app has no service worker — a deliberate choice (see README) — which
// means once a phone loads it, that in-memory copy just keeps running
// exactly as it was, for as long as the tab/PWA stays open, with no idea a
// newer version has been uploaded. Rather than relying on everyone
// remembering to force-refresh (or Barry having to ask "what version do you
// see?"), this polls a tiny version.json file every so often — fetched
// fresh every time, `cache: 'no-store'`, never from the browser's HTTP
// cache — and if its version doesn't match what's actually running, shows a
// small dismissible banner offering a one-tap reload. Identical for the
// driver and for every viewer on a shared link; version.json just needs to
// be bumped to match APP_VERSION with every upload (see README section 4,
// "Uploading an update — don't forget version.json").
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
let dismissedUpdateVersion = null; // "Later" on the banner suppresses re-nagging for this same version

// Parses "vYYYY.MM.DD.N" into 4 comparable numbers. Returns null for
// anything that doesn't match that shape, so a malformed/future version
// scheme just falls back to a plain string check (see isNewerVersion())
// rather than crashing.
function parseVersionParts(v) {
  // Accepts "." OR "-" between the number groups (v2026.09.16.1 as well as
  // a stray v2026.09.16-1) — a one-character typo like that is easy to
  // introduce hand-editing version.json and easy to miss reading it back
  // (a hyphen and a period look nearly identical in a compact UI font), and
  // it otherwise defeats the numeric comparison below entirely, falling
  // back to a plain "is this literally the same text" check that treats
  // the typo'd version as a mysterious newer one forever.
  const m = String(v || '').trim().match(/^v?(\d+)[.-](\d+)[.-](\d+)[.-](\d+)$/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), parseInt(m[4], 10)];
}

// True only when `a` is STRICTLY newer than `b` — deliberately not just
// "different". A naive !== check here is what caused the update banner to
// loop, claiming "a newer version is available" while naming the exact
// same version already running: version.json can briefly serve something
// stale right after a fresh upload (a CDN edge cache lagging behind, an
// old copy of the file re-uploaded by mistake, even just leading/trailing
// whitespace inside the string), and a plain inequality treats "stale and
// older" the same as "genuinely newer." Comparing the four numbers in
// order means equal or older never shows anything.
function isNewerVersion(a, b) {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return String(a).trim() !== '' && String(a).trim() !== String(b).trim();
  for (let i = 0; i < 4; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i];
  }
  return false;
}

async function checkForAppUpdate() {
  try {
    const res = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return;
    const data = await res.json();
    if (data.version && isNewerVersion(data.version, APP_VERSION) && data.version !== dismissedUpdateVersion) {
      showUpdateBanner(data.version);
    }
  } catch (e) {
    // Offline, or a dropped connection mid-drive — nothing to report; the
    // next scheduled check (or the next time the tab regains focus) will
    // just try again.
  }
}

function showUpdateBanner(newVersion) {
  if (document.getElementById('updateBanner')) return; // already showing
  const banner = document.createElement('div');
  banner.id = 'updateBanner';
  banner.className = 'update-banner';
  banner.innerHTML = `
    <span>🔄 A newer version is available (${escapeHtml(newVersion)}) — you're on ${escapeHtml(APP_VERSION)}.</span>
    <button id="updateReloadBtn">Reload Now</button>
    <button id="updateLaterBtn" class="update-later-btn">Later</button>
  `;
  document.body.appendChild(banner);

  // The banner floats over the page (position: fixed) rather than sitting
  // in normal document flow, so nothing else automatically makes room for
  // it — whatever happened to be at the very bottom of the page (like the
  // version footer on the setup screen) sits right underneath it and gets
  // covered. This got reported specifically as "only in portrait": in a
  // narrower width the banner's text/buttons wrap onto more lines and the
  // banner gets taller, while landscape's extra width fits it on one line
  // and it's short enough to miss whatever's behind it — so a fixed pixel
  // guess wouldn't survive a rotation. Instead this measures the banner's
  // actual rendered height and pads the page by exactly that much,
  // re-measuring live via ResizeObserver so a rotation (or the dynamic
  // island/notch inset changing) keeps it accurate automatically.
  const syncBodyPadding = () => { document.body.style.paddingBottom = banner.offsetHeight + 'px'; };
  syncBodyPadding();
  let bannerResizeObserver = null;
  if ('ResizeObserver' in window) {
    bannerResizeObserver = new ResizeObserver(syncBodyPadding);
    bannerResizeObserver.observe(banner);
  } else {
    // Older browser without ResizeObserver — orientation/resize events
    // still cover the case that actually got reported.
    window.addEventListener('resize', syncBodyPadding);
  }
  const cleanupBodyPadding = () => {
    document.body.style.paddingBottom = '';
    if (bannerResizeObserver) bannerResizeObserver.disconnect();
    else window.removeEventListener('resize', syncBodyPadding);
  };

  document.getElementById('updateReloadBtn').addEventListener('click', () => {
    // Cache-bust the reload itself, and keep whatever query string got you
    // here (?watch=PIN for a viewer on a shared link) so reloading doesn't
    // accidentally drop them back at the passcode screen.
    const url = new URL(window.location.href);
    url.searchParams.set('_r', Date.now());
    window.location.href = url.toString();
  });
  document.getElementById('updateLaterBtn').addEventListener('click', () => {
    dismissedUpdateVersion = newVersion;
    cleanupBodyPadding();
    banner.remove();
  });
}

function wireUpdateChecks() {
  setTimeout(checkForAppUpdate, 15000); // give the initial page load a moment to settle first
  setInterval(checkForAppUpdate, UPDATE_CHECK_INTERVAL_MS);
  // Catches the common case directly: a phone that's been sitting
  // backgrounded (overnight, or just in a pocket) gets checked again the
  // moment it's actually looked at, rather than waiting out the interval.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForAppUpdate();
  });
}

/* ============================== INIT ============================== */

function renderAppVersion() {
  document.querySelectorAll('.app-version-slot').forEach((el) => {
    el.textContent = `Road Trip Navigator ${APP_VERSION}`;
  });
}

function init() {
  renderAppVersion();
  wireUpdateChecks();
  wireHelpSystem();
  wireSettingsModal();
  wireSetupScreen();
  wireEndLeg();
  wireMyTripsAdd();
  wireVoiceControls();
  startVoiceKeepAlive();
  wireWakeLock();
  wireSharing();
  wireWatchScreen();
  wireEventActions();
  wireViewerMessageReplies();
  wireRerouteOffer();
  checkForActiveLeg();

  const linkedPin = getAutoWatchPinFromUrl();
  if (linkedPin) {
    // Someone tapped a shared watch link — go straight to watching, and
    // skip asking this browser for ITS OWN location. They only came here
    // to look at someone else's trip, so a location-permission prompt at
    // this point would just be confusing (and pointless, since a pure
    // viewer's own position is never used for anything).
    watchTripFromLink(linkedPin);
  } else {
    startLocationSource();
  }
  cleanupExpiredMedia(); // fire-and-forget; never blocks startup
}

document.addEventListener('DOMContentLoaded', init);
})();
