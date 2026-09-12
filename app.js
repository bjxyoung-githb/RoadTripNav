(function () {
'use strict';

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

function loadSettings() {
  const defaults = {
    orsKey: '', rangeMiles: null, breakMinutes: 120, voiceEnabled: false,
    locationSource: 'device', // 'device' (this device's own GPS, default) | 'relay' (phone via local relay, for PCs without GPS)
    relayUrl: '',
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
  pendingDest: null,    // {lat,lon,label} chosen from search results before route calc
  route: null,          // {coords:[[lon,lat]], cumDist:[mi], cumDur:[s], steps:[], totalDist, totalDur}
  currentStepIndex: 0,
  lastRerouteAt: 0,
  driving: { continuousSince: null, stoppedSince: null, lastRestSuggestedAt: null },
  cache: {
    weatherFetchedAtMiles: null, weatherFetchedAt: 0,
    poiFetchedAtMiles: null, poiFetchedAt: 0,
    peaksFetchedAtMiles: null, peaksFetchedAt: 0,
  },
  map: null, routeLine: null, currentMarker: null, destMarker: null, poiMarkers: [], peakMarkers: [],
  eventMarkers: [],
  fb: null, // {app, auth, db, storage, uid} once Firebase is configured and signed in
  share: { active: false, pin: null, ownerUid: null, unsubEvents: null, events: [], lastPushAt: 0, lastPushLoc: null },
  watch: { pin: null, trip: null, events: [], unsubTrip: null, unsubEvents: null, map: null, routeLine: null, liveMarker: null, eventMarkers: {}, weatherFetchedAt: 0, weatherLoc: null },
};

/* ============================== ROUTE-SAMPLE MARKERS CLEANUP ============================== */
function clearMarkers(arr) { arr.forEach((m) => state.map.removeLayer(m)); arr.length = 0; }

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
  // address-level precision came back, the free-text parser may have failed
  // to split the address correctly. Retry with a structured query, which
  // parses each part (address/locality/region) separately and often finds
  // an exact match the plain search missed.
  const hasHouseNumber = /^\s*\d+\s+\S/.test(text);
  const hasAddressHit = results.some((r) => r.layer === 'address');
  if (hasHouseNumber && !hasAddressHit) {
    try {
      const structured = await orsGeocodeStructured(text, focus);
      if (structured.length) {
        // Put any address-level structured hits first, then the rest, deduped by label.
        const seen = new Set(results.map((r) => r.label));
        structured.forEach((r) => { if (!seen.has(r.label)) { results.push(r); seen.add(r.label); } });
        results.sort((a, b) => (a.layer === 'address' ? -1 : 0) - (b.layer === 'address' ? -1 : 0));
      }
    } catch (e) { /* structured search is a best-effort extra try; ignore failures */ }
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

async function orsRoute(start, end) {
  const key = state.settings.orsKey;
  if (!key) throw new Error('No ORS API key set. Open Settings to add one.');
  const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
    method: 'POST',
    headers: { 'Authorization': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      coordinates: [[start.lon, start.lat], [end.lon, end.lat]],
      units: 'mi',
      instructions: true,
      language: 'en',
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('Routing failed (' + res.status + '): ' + t.slice(0, 200));
  }
  const geojson = await res.json();
  const feature = geojson.features[0];
  const coords = feature.geometry.coordinates; // [lon,lat]
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
  if (state.manualStart) return; // manual overrides display already set
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
  calcBtn.disabled = !(getStartCoords() && state.pendingDest && state.settings.orsKey);
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

function speak(text) {
  if (!voiceSupported() || !state.settings.voiceEnabled) return;
  try {
    window.speechSynthesis.cancel(); // don't let announcements pile up/overlap
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0;
    window.speechSynthesis.speak(u);
  } catch (e) { /* ignore */ }
}

// Unlocks audio on browsers (notably iOS Safari) that require the first
// speechSynthesis call to originate from a direct user tap.
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

/* ============================== MAIN NAVIGATION LOOP ============================== */

function findNearestIndex(lat, lon) {
  const { coords } = state.route;
  let best = 0, bestD = Infinity;
  for (let i = 0; i < coords.length; i++) {
    const d = haversineMiles(lat, lon, coords[i][1], coords[i][0]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return { idx: best, dist: bestD };
}

async function maybeReroute(offRouteMiles, curLat, curLon) {
  const now = Date.now();
  if (offRouteMiles < 0.5) return false;
  if (now - state.lastRerouteAt < 2 * 60 * 1000) return false;
  state.lastRerouteAt = now;
  toast('You appear off-route — recalculating…', 5000);
  speak('Recalculating route.');
  try {
    const dest = state.route.destForReroute;
    const newRoute = await orsRoute({ lat: curLat, lon: curLon }, dest);
    newRoute.destForReroute = dest;
    state.route = newRoute;
    state.announced = new Set();
    state.arrivalAnnounced = false;
    drawRoute();
    return true;
  } catch (e) {
    toast('Reroute failed: ' + e.message, 6000);
    return false;
  }
}

const VOICE_ANNOUNCE_MILES = 1.0;
const VOICE_IMMINENT_MILES = 0.25;

function announceStepIfDue(stepIdx, step, distToManeuver) {
  if (!state.announced) state.announced = new Set();
  const farKey = stepIdx + '_far';
  const nearKey = stepIdx + '_near';
  if (distToManeuver <= VOICE_ANNOUNCE_MILES && !state.announced.has(farKey)) {
    state.announced.add(farKey);
    speak(`In ${fmtMiles(distToManeuver)}, ${step.instruction}.`);
  }
  if (distToManeuver <= VOICE_IMMINENT_MILES && !state.announced.has(nearKey)) {
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
  }

  if (!state.route) return;

  const { idx, dist } = findNearestIndex(cur.lat, cur.lon);
  nearestIndexCache = idx;
  const traveled = state.route.cumDist[idx];
  const total = state.route.totalDist;
  const remaining = Math.max(0, total - traveled);

  document.getElementById('statMilesLeft').textContent = fmtMiles(remaining);

  const remainingDur = Math.max(0, state.route.totalDur - state.route.cumDur[idx]);
  document.getElementById('statEta').textContent = fmtClockFromNowPlus(remainingDur);

  const speedMph = typeof cur.speed === 'number' && cur.speed >= 0 ? cur.speed * MPS_TO_MPH : null;
  document.getElementById('statSpeed').textContent = speedMph != null ? Math.round(speedMph) : '–';
  updateBaseLayerForSpeed(speedMph);

  // Determine current/next step
  const steps = state.route.steps;
  let stepIdx = steps.findIndex((s) => idx <= s.way_points[1]);
  if (stepIdx === -1) stepIdx = steps.length - 1;
  state.currentStepIndex = stepIdx;
  const step = steps[stepIdx];
  const distToManeuver = Math.max(0, state.route.cumDist[step.way_points[1]] - traveled);
  document.getElementById('statNextTurn').textContent = step.instruction;
  document.getElementById('statNextTurnDist').textContent = 'in ' + fmtMiles(distToManeuver);

  renderSteps(stepIdx);
  announceStepIfDue(stepIdx, step, distToManeuver);

  if (remaining < 0.05) {
    if (!state.arrivalAnnounced) {
      state.arrivalAnnounced = true;
      toast('🎉 You have arrived at your destination!', 8000);
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
  maybePushShareLocation();
}

function renderSteps(currentIdx) {
  const panel = document.getElementById('stepsPanel');
  const steps = state.route.steps;
  panel.innerHTML = steps.map((s, i) => `
    <div class="step-item ${i === currentIdx ? 'current' : ''}">
      ${s.instruction}
      <div class="step-dist">${fmtMiles(s.distance)}${s.name && s.name !== '-' ? ' on ' + s.name : ''}</div>
    </div>`).join('');
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

  // Road/place name labels drawn on top of the satellite imagery, so
  // satellite mode still shows street names rather than being a bare photo.
  state.satLabelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Esri',
    maxZoom: 19,
  }).addTo(state.map);

  state.effectiveLayer = 'satellite';
  state.streetLayer.setOpacity(0);
  state.satLayer.setOpacity(1);
  state.satLabelsLayer.setOpacity(1);

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
  const FullscreenToggleControl = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function () {
      const div = L.DomUtil.create('div', 'leaflet-bar map-toggle-btn');
      div.innerText = fullscreenControlLabel();
      div.title = 'Expand the map to full screen, or return to the split view';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div, 'click', () => {
        toggleMapFullscreen();
        div.innerText = fullscreenControlLabel();
      });
      state.fullscreenToggleDiv = div;
      return div;
    },
  });
  new FullscreenToggleControl().addTo(state.map);
}

function fullscreenControlLabel() {
  return state.mapFullscreen ? '↙ Exit Full Map' : '⛶ Full Map';
}

function toggleMapFullscreen() {
  state.mapFullscreen = !state.mapFullscreen;
  document.getElementById('dashboard').classList.toggle('map-fullscreen', state.mapFullscreen);
  if (state.fullscreenToggleDiv) state.fullscreenToggleDiv.innerText = fullscreenControlLabel();
  // The map's container just changed size via CSS; Leaflet needs to be told
  // so it re-measures and doesn't leave stale/partial tiles at the edges.
  setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 50);
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

function drawRoute() {
  if (state.routeLine) state.map.removeLayer(state.routeLine);
  const latlngs = state.route.coords.map((c) => [c[1], c[0]]);
  state.routeLine = L.polyline(latlngs, { color: '#3b82f6', weight: 5 }).addTo(state.map);

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

  const bounds = state.pinMarker
    ? state.routeLine.getBounds().extend(state.pinMarker.getLatLng())
    : state.routeLine.getBounds();
  state.map.fitBounds(bounds, { padding: [30, 30] });
}

/* ============================== FIREBASE / TRIP SHARING ============================== */
// Optional feature: lets other people watch your live position, photos/videos,
// and comments during a leg by entering a passcode. Requires a free Firebase
// project — see firebase-config.js and README.md section 7. Nothing here
// runs, and no network calls are made, until that config is filled in.

function firebaseConfigured() {
  const c = window.FIREBASE_CONFIG;
  return !!(c && c.apiKey && !String(c.apiKey).startsWith('YOUR_'));
}

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
      const storage = firebase.storage(app);
      auth.onAuthStateChanged((user) => {
        if (user) { state.fb = { app, auth, db, storage, uid: user.uid }; resolve(state.fb); }
      });
      auth.signInAnonymously().catch((e) => reject(new Error('Firebase sign-in failed: ' + e.message)));
    } catch (e) { reject(e); }
  });
  return fbInitPromise;
}

function randomPin() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function generateUniquePin(db, uid) {
  for (let i = 0; i < 6; i++) {
    const pin = randomPin();
    const snap = await db.collection('trips').doc(pin).get();
    if (!snap.exists) return pin;
    const data = snap.data();
    if (data.ownerUid === uid || data.active === false) return pin; // safe to reuse
  }
  return randomPin(); // extremely unlikely to still collide
}

// Firestore documents are capped at 1MB; a multi-day route can have
// thousands of coordinate points, so thin it down to a shape that's still
// plenty smooth on a viewer's map.
function sampleRouteForShare(coords, maxPoints) {
  maxPoints = maxPoints || 300;
  if (coords.length <= maxPoints) return coords.map((c) => [c[1], c[0]]);
  const out = [];
  const step = (coords.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    const idx = Math.round(i * step);
    out.push([coords[idx][1], coords[idx][0]]);
  }
  return out;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function startSharing() {
  const panel = document.getElementById('sharePanel');
  if (!state.route) { toast('Calculate a route first.', 4000); return; }
  panel.innerHTML = '<span class="muted">Connecting…</span>';
  try {
    const { db, uid } = await initFirebase();
    const pin = await generateUniquePin(db, uid);
    const routeCoords = sampleRouteForShare(state.route.coords, 300);
    await db.collection('trips').doc(pin).set({
      ownerUid: uid,
      destLabel: (state.route.destForReroute && state.route.destForReroute.label) || 'Destination',
      startedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      active: true,
      routeCoords,
      totalMiles: state.route.totalDist,
      lastLocation: state.loc ? { lat: state.loc.lat, lon: state.loc.lon, heading: state.loc.heading, speed: state.loc.speed, updatedAt: Date.now() } : null,
    });

    state.share.active = true;
    state.share.pin = pin;
    state.share.ownerUid = uid;
    state.share.lastPushAt = Date.now();
    state.share.lastPushLoc = state.loc ? { lat: state.loc.lat, lon: state.loc.lon } : null;
    subscribeOwnEvents(pin);
    renderSharePanel();
    toast('Sharing started — passcode ' + pin, 6000);
  } catch (e) {
    panel.innerHTML = `<span class="muted">Couldn't start sharing: ${e.message}</span>`;
  }
}

async function stopSharing() {
  const sh = state.share;
  const pin = sh.pin;
  if (sh.unsubEvents) { sh.unsubEvents(); sh.unsubEvents = null; }
  if (pin && state.fb) {
    try {
      await state.fb.db.collection('trips').doc(pin).set(
        { active: false, updatedAt: firebase.firestore.FieldValue.serverTimestamp() }, { merge: true });
    } catch (e) { /* best effort — stale doc will just show "sharing ended" to viewers */ }
  }
  clearMarkers(state.eventMarkers);
  sh.active = false; sh.pin = null; sh.ownerUid = null; sh.events = [];
  sh.lastPushAt = 0; sh.lastPushLoc = null;
  renderSharePanel();
  toast('Sharing stopped.', 3000);
}

function maybePushShareLocation() {
  const sh = state.share;
  if (!sh.active || !state.fb || !state.loc) return;
  const now = Date.now();
  const movedFar = !sh.lastPushLoc || haversineMiles(sh.lastPushLoc.lat, sh.lastPushLoc.lon, state.loc.lat, state.loc.lon) > 0.02;
  if (now - sh.lastPushAt < 15000 && !movedFar) return;
  sh.lastPushAt = now;
  sh.lastPushLoc = { lat: state.loc.lat, lon: state.loc.lon };
  state.fb.db.collection('trips').doc(sh.pin).set({
    lastLocation: { lat: state.loc.lat, lon: state.loc.lon, heading: state.loc.heading, speed: state.loc.speed, updatedAt: now },
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }).catch(() => { /* best effort; next cycle retries */ });
}

function subscribeOwnEvents(pin) {
  if (state.share.unsubEvents) state.share.unsubEvents();
  state.share.unsubEvents = state.fb.db.collection('trips').doc(pin).collection('events')
    .orderBy('createdAt', 'desc')
    .onSnapshot((snap) => {
      const events = [];
      snap.forEach((doc) => events.push({ id: doc.id, ...doc.data() }));
      state.share.events = events;
      renderSharePanel();
      renderOwnEventMarkers(events);
    }, (e) => toast('Trip log sync error: ' + e.message, 5000));
}

async function addPhotoOrVideo(file) {
  const sh = state.share;
  if (!sh.active) { toast('Start sharing first to attach photos/videos to your trip.', 5000); return; }
  if (!state.loc) { toast('Waiting for GPS before tagging a location.', 4000); return; }
  const isVideo = file.type.startsWith('video/');
  toast('Uploading ' + (isVideo ? 'video' : 'photo') + '…', 10000);
  try {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `trip-media/${sh.pin}/${state.fb.uid}/${Date.now()}_${safeName}`;
    const snap = await state.fb.storage.ref(path).put(file);
    const url = await snap.ref.getDownloadURL();
    await state.fb.db.collection('trips').doc(sh.pin).collection('events').add({
      type: isVideo ? 'video' : 'photo',
      mediaUrl: url,
      mediaType: file.type,
      lat: state.loc.lat, lon: state.loc.lon,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast((isVideo ? 'Video' : 'Photo') + ' added to your trip.', 4000);
  } catch (e) {
    toast('Upload failed: ' + e.message, 6000);
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    toast('Comment added.', 3000);
  } catch (e) {
    toast("Couldn't add comment: " + e.message, 5000);
  }
}

function renderEventItem(ev) {
  const when = (ev.createdAt && ev.createdAt.toDate)
    ? ev.createdAt.toDate().toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    : 'just now';
  if (ev.type === 'comment') {
    return `<div class="event-item"><div class="event-icon">💬</div><div>
      <div class="item-main">${escapeHtml(ev.text || '')}</div>
      <div class="item-sub">${when}</div></div></div>`;
  }
  const isVideo = ev.type === 'video';
  const media = isVideo
    ? `<video src="${ev.mediaUrl}" class="event-thumb" controls playsinline></video>`
    : `<img src="${ev.mediaUrl}" class="event-thumb" alt="Trip photo" loading="lazy">`;
  return `<div class="event-item">${media}<div>
    <div class="item-main">${isVideo ? '🎥 Video' : '📷 Photo'}</div>
    <div class="item-sub">${when}</div></div></div>`;
}

function makeEventMarker(ev) {
  const iconEmoji = ev.type === 'comment' ? '💬' : ev.type === 'video' ? '🎥' : '📷';
  const icon = L.divIcon({
    className: 'event-marker',
    html: `<div class="event-marker-icon">${iconEmoji}</div>`,
    iconSize: [26, 26], iconAnchor: [13, 24],
  });
  const popupHtml = ev.type === 'comment'
    ? `<b>💬 Comment</b><br>${escapeHtml(ev.text || '')}`
    : ev.type === 'video'
      ? `<b>🎥 Video</b><br><video src="${ev.mediaUrl}" controls playsinline style="max-width:220px;max-height:220px;"></video>`
      : `<b>📷 Photo</b><br><img src="${ev.mediaUrl}" style="max-width:220px;max-height:220px;">`;
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

function renderSharePanel() {
  const panel = document.getElementById('sharePanel');
  if (!panel) return;
  if (!firebaseConfigured()) {
    panel.innerHTML = '<span class="muted">Not set up yet — see README.md section 7 to enable live sharing, photos/videos, and comments with family.</span>';
    return;
  }
  const sh = state.share;
  if (!sh.active) {
    panel.innerHTML = `
      <div class="hint">Share your live position, photos/videos, and comments with family for this leg — they watch by entering a passcode, no app or account needed on their end.</div>
      <button id="startSharingBtn" class="primary-btn" style="margin-top:10px;">Start Sharing This Leg</button>`;
    document.getElementById('startSharingBtn').onclick = startSharing;
    return;
  }
  const eventsHtml = sh.events.length
    ? sh.events.map(renderEventItem).join('')
    : '<div class="muted" style="padding:8px 0;">No photos, videos, or comments yet.</div>';
  panel.innerHTML = `
    <div class="share-pin-box">
      <div class="share-pin-lbl">Passcode to watch this trip</div>
      <div class="share-pin-big">${sh.pin}</div>
      <div class="hint">Give this 6-digit code to family — they open this same web address, tap "Watch someone else's shared trip," and enter it.</div>
    </div>
    <div class="share-actions">
      <button id="addPhotoBtn" class="ghost-btn small">📷 Photo/Video</button>
      <button id="addCommentBtn" class="ghost-btn small">💬 Comment</button>
      <button id="stopSharingBtn" class="ghost-btn small">Stop Sharing</button>
    </div>
    <div id="commentInputRow" class="comment-input-row hidden">
      <input id="commentTextInput" type="text" placeholder="Say something about where you are…" maxlength="500">
      <button id="commentSendBtn" class="ghost-btn small">Send</button>
    </div>
    <div class="event-list">${eventsHtml}</div>`;

  document.getElementById('addPhotoBtn').onclick = () => document.getElementById('mediaFileInput').click();
  document.getElementById('addCommentBtn').onclick = () => document.getElementById('commentInputRow').classList.toggle('hidden');
  document.getElementById('stopSharingBtn').onclick = stopSharing;
  document.getElementById('commentSendBtn').onclick = () => {
    const input = document.getElementById('commentTextInput');
    addComment(input.value);
    input.value = '';
    document.getElementById('commentInputRow').classList.add('hidden');
  };
  document.getElementById('commentTextInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('commentSendBtn').click();
  });
}

function wireSharing() {
  document.getElementById('mediaFileInput').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) addPhotoOrVideo(file);
    e.target.value = '';
  });
  renderSharePanel();
}

/* ============================== WATCH (VIEWER) MODE ============================== */
// The read-only counterpart to sharing above: anyone with the passcode opens
// this same page, enters it, and sees the traveler's route, live position,
// and photo/video/comment pins update in real time — no account needed.

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
}

async function watchTrip(pin) {
  const errEl = document.getElementById('watchError');
  errEl.textContent = '';
  if (!firebaseConfigured()) {
    errEl.textContent = "Trip sharing isn't set up in this app yet — ask the traveler to check README.md section 7.";
    return;
  }
  try {
    const { db } = await initFirebase();
    const snap = await db.collection('trips').doc(pin).get();
    if (!snap.exists) { errEl.textContent = 'No trip found with that passcode.'; return; }

    stopWatching();
    state.watch.pin = pin;
    document.getElementById('watchPinEntry').classList.add('hidden');
    document.getElementById('watchLive').classList.remove('hidden');
    setTimeout(initWatchMap, 0);

    state.watch.unsubTrip = db.collection('trips').doc(pin).onSnapshot((doc) => {
      if (!doc.exists) { renderWatchStatus('This trip is no longer available.'); return; }
      state.watch.trip = doc.data();
      renderWatchTrip();
    }, (e) => renderWatchStatus('Connection error: ' + e.message));

    state.watch.unsubEvents = db.collection('trips').doc(pin).collection('events')
      .orderBy('createdAt', 'desc')
      .onSnapshot((qs) => {
        const events = [];
        qs.forEach((d) => events.push({ id: d.id, ...d.data() }));
        state.watch.events = events;
        renderWatchEvents(events);
      });
  } catch (e) {
    errEl.textContent = "Couldn't connect: " + e.message;
  }
}

function stopWatching() {
  if (state.watch.unsubTrip) { state.watch.unsubTrip(); state.watch.unsubTrip = null; }
  if (state.watch.unsubEvents) { state.watch.unsubEvents(); state.watch.unsubEvents = null; }
  state.watch.pin = null;
  state.watch.trip = null;
  state.watch.events = [];
  state.watch.eventMarkers = {};
  state.watch.weatherFetchedAt = 0;
  state.watch.weatherLoc = null;
  if (state.watch.map) { state.watch.map.remove(); state.watch.map = null; }
  state.watch.routeLine = null;
  state.watch.liveMarker = null;
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

function liveTooltipText(loc) {
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
    renderWatchWeather(`🌦 ${cur.temperature}°${cur.temperatureUnit} — ${cur.shortForecast} · wind ${cur.windSpeed}`);
  } catch (e) {
    renderWatchWeather('Weather unavailable at this location (US only).');
  }
}

function initWatchMap() {
  if (state.watch.map) return;
  const map = L.map('watchMap', { zoomControl: true }).setView([37.5, -96], 4);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(map);
  state.watch.map = map;
  if (state.watch.trip) renderWatchTrip();
  if (state.watch.events) renderWatchEvents(state.watch.events);
}

function renderWatchStatus(msg) {
  const el = document.getElementById('watchStatus');
  if (el) el.textContent = msg;
}

function renderWatchTrip() {
  const trip = state.watch.trip;
  if (!trip) return;
  const map = state.watch.map;

  if (map && trip.routeCoords && trip.routeCoords.length && !state.watch.routeLine) {
    state.watch.routeLine = L.polyline(trip.routeCoords, { color: '#3b82f6', weight: 5 }).addTo(map);
    map.fitBounds(state.watch.routeLine.getBounds(), { padding: [30, 30] });
  }

  if (map && trip.lastLocation) {
    const ll = [trip.lastLocation.lat, trip.lastLocation.lon];
    const icon = liveMarkerIcon(trip.lastLocation.heading);
    const tooltipText = liveTooltipText(trip.lastLocation);
    if (!state.watch.liveMarker) {
      state.watch.liveMarker = L.marker(ll, { icon })
        .bindTooltip(tooltipText, { permanent: true, direction: 'top', className: 'live-tooltip', offset: [0, -14] })
        .addTo(map);
    } else {
      state.watch.liveMarker.setLatLng(ll);
      state.watch.liveMarker.setIcon(icon);
      state.watch.liveMarker.setTooltipContent(tooltipText);
    }
    if (trip.active) maybeRefreshWatchWeather(trip.lastLocation);
  }

  const ageSec = trip.lastLocation ? (Date.now() - (trip.lastLocation.updatedAt || 0)) / 1000 : null;
  let status;
  if (!trip.active) status = 'This trip has ended sharing.';
  else if (!trip.lastLocation) status = "Waiting for the traveler's first location update…";
  else {
    status = `Heading to ${trip.destLabel || 'destination'} · updated ${ageSec < 60 ? Math.round(ageSec) + 's' : Math.round(ageSec / 60) + 'm'} ago` +
      (ageSec > 120 ? ' — last known position may be stale' : '');
  }
  renderWatchStatus(status);
}

function renderWatchEvents(events) {
  const el = document.getElementById('watchEvents');
  if (!el) return;
  el.innerHTML = events.length
    ? events.map(renderEventItem).join('')
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
    startInput.disabled = false;
    startInput.value = '';
    startInput.placeholder = 'Type a starting address…';
    startInput.focus();
    document.getElementById('startFineTune').classList.add('hidden');
  });
  startInput.addEventListener('input', (e) => {
    document.getElementById('startFineTune').classList.add('hidden');
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
      const route = await orsRoute(start, dest);
      route.destForReroute = dest;
      state.route = route;
      state.currentStepIndex = 0;
      state.lastRerouteAt = 0;
      state.announced = new Set();
      state.arrivalAnnounced = false;

      const legLabel = document.getElementById('legLabelInput').value.trim();
      const leg = {
        id: 'leg_' + Date.now(),
        label: legLabel || null,
        destLabel: dest.label,
        destLat: dest.lat, destLon: dest.lon,
        createdAt: Date.now(),
      };
      state.trip.legs.push(leg);
      saveTrip(state.trip);

      document.getElementById('setupScreen').classList.add('hidden');
      document.getElementById('dashboard').classList.remove('hidden');
      if (!state.map) initMap();
      drawRoute();
      onLocationUpdate();
      renderSharePanel();
    } catch (e) {
      errEl.textContent = e.message;
    } finally {
      calcBtn.disabled = false;
      calcBtn.textContent = 'Calculate Route';
    }
  });

  renderLegsList();
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

  function syncRelayRowVisibility() {
    relayUrlRow.classList.toggle('hidden', !locRelayRadio.checked);
  }

  function openModal() {
    orsInput.value = state.settings.orsKey || '';
    rangeInput.value = state.settings.rangeMiles || '';
    breakInput.value = state.settings.breakMinutes != null ? state.settings.breakMinutes : 120;
    (state.settings.locationSource === 'relay' ? locRelayRadio : locDeviceRadio).checked = true;
    relayUrlInput.value = state.settings.relayUrl || '';
    syncRelayRowVisibility();
    modal.classList.remove('hidden');
  }
  openBtn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
  locDeviceRadio.addEventListener('change', syncRelayRowVisibility);
  locRelayRadio.addEventListener('change', syncRelayRowVisibility);

  saveBtn.addEventListener('click', () => {
    state.settings.orsKey = orsInput.value.trim();
    state.settings.rangeMiles = rangeInput.value ? parseFloat(rangeInput.value) : null;
    state.settings.breakMinutes = breakInput.value ? parseInt(breakInput.value, 10) : 0;
    const newLocationSource = locRelayRadio.checked ? 'relay' : 'device';
    const newRelayUrl = relayUrlInput.value.trim();
    const locationSettingChanged = newLocationSource !== state.settings.locationSource || newRelayUrl !== state.settings.relayUrl;
    state.settings.locationSource = newLocationSource;
    state.settings.relayUrl = newRelayUrl;
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
  });

  toggleBtn.addEventListener('click', () => {
    state.settings.voiceEnabled = !state.settings.voiceEnabled;
    if (state.settings.voiceEnabled) unlockVoice();
    saveSettings(state.settings);
    updateVoiceButtons();
    toast(state.settings.voiceEnabled ? 'Voice guidance on.' : 'Voice guidance muted.', 2500);
  });

  updateVoiceButtons();
}

/* ============================== END LEG ============================== */

function wireEndLeg() {
  document.getElementById('endLegBtn').addEventListener('click', () => {
    if (state.share.active) stopSharing();
    state.route = null;
    document.getElementById('dashboard').classList.add('hidden');
    document.getElementById('setupScreen').classList.remove('hidden');
    document.getElementById('destInput').value = '';
    document.getElementById('legLabelInput').value = '';
    state.pendingDest = null;
    renderLegsList();
    refreshCalcButton();
  });
}

/* ============================== INIT ============================== */

function init() {
  wireSettingsModal();
  wireSetupScreen();
  wireEndLeg();
  wireVoiceControls();
  wireSharing();
  wireWatchScreen();
  startLocationSource();
}

document.addEventListener('DOMContentLoaded', init);
})();
