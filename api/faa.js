/* Enhanced Patrol FAA relay.
   Two FAA sources refuse browser requests from other sites (no CORS), so the tools call them through
   this function instead. It is not an open proxy: the upstream URLs are fixed, the only input is a
   bounding box, and responses are cached at the edge.
     GET /api/faa?src=tfr&bbox=minLng,minLat,maxLng,maxLat    TFR shapes (FAA tfr.faa.gov) touching the box
     GET /api/faa?src=metar&bbox=minLng,minLat,maxLng,maxLat  Current METARs (aviationweather.gov) in the box
     GET /api/faa?src=taf&bbox=minLng,minLat,maxLng,maxLat    Current TAFs (aviationweather.gov) in the box
     GET /api/faa?src=layer&layer=KEY&z=Z&x=X&y=Y              One map tile of an FAA airspace layer as GeoJSON
     GET /api/faa?src=forecast&lat=LAT&lng=LNG                 National Weather Service hourly forecast grid for the point,
       reshaped into the hourly layout the tools use (mph, F, inches, local time), cached 10 min.
       NWS data is public domain, so it is free for commercial use. NWS has no wind above 10 m, so
       80 m and 120 m wind is estimated from the surface wind with a standard 1/7 power-law profile.
     GET /api/faa?src=elev&lat=LAT&lng=LNG                     Ground elevation from USGS 3DEP (EPQS), meters.
   Map layers go through here as fixed tiles so the edge cache serves repeat views. The FAA ArcGIS services
   allow about 6,000 request units per minute per client; drawing the map straight from the browser used
   that up and starved the pin lookup. */
const ARC = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
const TILE_LAYERS = {
  uasfm: { z: 12, svcs: ['FAA_UAS_FacilityMap_Data'], fields: 'OBJECTID,CEILING', precision: 5 },
  cls:   { z: 7, svcs: ['Class_Airspace'], fields: 'OBJECTID,NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_CODE',
           where: "CLASS IN ('B','C','D') OR LOCAL_TYPE IN ('CLASS_E2','CLASS_E3','CLASS_E4')", offset: 0.0004 },
  sua:   { z: 7, svcs: ['Special_Use_Airspace'], fields: 'OBJECTID,NAME,TYPE_CODE,LOWER_VAL,UPPER_VAL', offset: 0.0006 },
  nsr:   { z: 7, svcs: ['DoD_Mar_13', 'Part_Time_National_Security_UAS_Flight_Restrictions', 'Prohibited_Areas', 'National_Defense_Airspace_TFR_Areas'],
           fields: '*', offset: 0.0002 },
  stad:  { z: 7, svcs: ['Stadiums'], fields: 'OBJECTID,NAME', points: true },
  apt:   { z: 9, svcs: ['US_Airport'], fields: 'OBJECTID,IDENT,NAME,TYPE_CODE', points: true }
};
function tileBbox(z, x, y) {
  const n = Math.pow(2, z);
  const lon = v => v / n * 360 - 180;
  const lat = v => Math.atan(Math.sinh(Math.PI * (1 - 2 * v / n))) * 180 / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}
async function arcTile(def, bbox) {
  const out = [];
  for (const svc of def.svcs) {
    const p = new URLSearchParams({
      where: def.where || '1=1', geometry: bbox.map(n => n.toFixed(6)).join(','), geometryType: 'esriGeometryEnvelope',
      inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: def.fields, returnGeometry: 'true', outSR: '4326',
      geometryPrecision: String(def.precision || 5), resultRecordCount: '2000', f: 'geojson'
    });
    if (def.offset) p.set('maxAllowableOffset', String(def.offset));
    const j = await getJson(ARC + svc + '/FeatureServer/0/query?' + p.toString(), 15000);
    if (j && j.error) { const e = new Error(j.error.message || 'ArcGIS error'); e.code = j.error.code; throw e; }
    (j && j.features || []).forEach(f => { f.id = svc + ':' + (f.id != null ? f.id : (f.properties && f.properties.OBJECTID)); out.push(f); });
  }
  return out;
}
const TFR_URL = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature' +
  '&typeName=TFR:V_TFR_LOC&outputFormat=application/json&srsname=EPSG:4326' +
  '&propertyName=NOTAM_KEY,TITLE,STATE,LEGAL,CNS_LOCATION_ID,LAST_MODIFICATION_DATETIME,SHAPE';
const METAR_URL = 'https://aviationweather.gov/api/data/metar?format=json&bbox=';
const TAF_URL = 'https://aviationweather.gov/api/data/taf?format=json&bbox=';
const UA = 'EnhancedPatrol-SiteTools/1.0 (ep-drone-tools.vercel.app)';
const NWS = 'https://api.weather.gov';
const EPQS = 'https://epqs.nationalmap.gov/v1/json';
async function retry(fn, waits) {
  let last;
  for (let i = 0; i <= waits.length; i++) {
    try { return await fn(); } catch (e) { last = e; if (i < waits.length) await new Promise(r => setTimeout(r, waits[i])); }
  }
  throw last;
}
const TFR_TTL_MS = 5 * 60 * 1000;
let tfrCache = { t: 0, features: null };

function parseBbox(s) {
  const p = String(s || '').split(',').map(Number);
  if (p.length !== 4 || p.some(n => !Number.isFinite(n))) return null;
  const [x0, y0, x1, y1] = p;
  if (x0 < -180 || x1 > 180 || y0 < -90 || y1 > 90 || x0 >= x1 || y0 >= y1) return null;
  if (x1 - x0 > 12 || y1 - y0 > 8) return null;          // a regional view at most
  return [x0, y0, x1, y1];
}
function featureBounds(g) {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const walk = c => { if (typeof c[0] === 'number') { x0 = Math.min(x0, c[0]); x1 = Math.max(x1, c[0]); y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); } else c.forEach(walk); };
  if (g && g.coordinates) walk(g.coordinates);
  return [x0, y0, x1, y1];
}
async function getJson(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('upstream HTTP ' + r.status);
    const txt = await r.text();
    return txt ? JSON.parse(txt) : [];
  } finally { clearTimeout(t); }
}

/* ---- National Weather Service forecast grid -> hourly arrays ---- */
async function nwsJson(url, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/geo+json' }, signal: ctl.signal });
    if (!r.ok) throw new Error('NWS HTTP ' + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}
const pointCache = new Map();   // "lat,lng" -> { t, grid, tz }
function isoDurHours(d) {
  const m = /P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?/.exec(d || '');
  if (!m) return 1;
  return (Number(m[1] || 0) * 24) + Number(m[2] || 0) + (Number(m[3] || 0) / 60) || 1;
}
/* Expand an NWS gridpoint series ({validTime: "start/PTnH", value}) to one value per hour from t0. */
function hourly(series, t0, n, perHour) {
  const out = new Array(n).fill(null);
  (series && series.values || []).forEach(v => {
    const [start, dur] = String(v.validTime).split('/');
    const s0 = Date.parse(start), hrs = isoDurHours(dur);
    for (let h = 0; h < hrs; h++) {
      const i = Math.round((s0 + h * 3600e3 - t0) / 3600e3);
      if (i >= 0 && i < n) out[i] = perHour && typeof v.value === 'number' ? v.value / hrs : v.value;
    }
  });
  return out;
}
function tzOffsetSec(tz, d) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(d).map(x => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000) * 60;
  } catch (e) { return 0; }
}
/* WMO-style weather code from the NWS weather list and sky cover, so the tools keep one vocabulary. */
function wmoCode(wx, sky) {
  const list = (Array.isArray(wx) ? wx : []).filter(w => w && w.weather && !/slight_chance|^chance$/.test(w.coverage || ''));
  const has = k => list.find(w => w.weather === k);
  const heavy = w => w && w.intensity === 'heavy', light = w => w && /light/.test(w.intensity || '');
  if (has('thunderstorms')) return 95;
  if (has('freezing_rain')) return 66;
  if (has('snow') || has('snow_showers')) return heavy(has('snow') || has('snow_showers')) ? 75 : 71;
  if (has('rain_showers')) return heavy(has('rain_showers')) ? 81 : 80;
  if (has('rain')) return heavy(has('rain')) ? 65 : light(has('rain')) ? 61 : 63;
  if (has('drizzle') || has('freezing_drizzle')) return 51;
  if (has('fog') || has('freezing_fog')) return 45;
  if (sky == null) return 2;
  return sky <= 12 ? 0 : sky <= 37 ? 1 : sky <= 75 ? 2 : 3;
}
async function nwsForecast(lat, lng) {
  const key = lat.toFixed(3) + ',' + lng.toFixed(3);
  let pt = pointCache.get(key);
  if (!pt || Date.now() - pt.t > 6 * 3600e3) {
    const j = await retry(() => nwsJson(NWS + '/points/' + lat.toFixed(4) + ',' + lng.toFixed(4), 9000), [800, 2500]);
    const p = j && j.properties;
    if (!p || !p.forecastGridData) throw new Error('No NWS forecast grid for this point (outside the US?)');
    pt = { t: Date.now(), grid: p.forecastGridData, tz: p.timeZone || 'UTC' };
    pointCache.set(key, pt);
  }
  const g = await retry(() => nwsJson(pt.grid, 12000), [1000, 3000]);
  const P = g && g.properties;
  if (!P || !P.temperature) throw new Error('unexpected NWS grid response');
  const n = 48, now = new Date(), t0 = Math.floor(now.getTime() / 3600e3) * 3600e3;
  const off = tzOffsetSec(pt.tz, now);
  const kmh = v => v == null ? null : Math.round(v * 0.621371 * 10) / 10;
  const cToF = v => v == null ? null : Math.round((v * 9 / 5 + 32) * 10) / 10;
  const temp = hourly(P.temperature, t0, n), dew = hourly(P.dewpoint, t0, n), rh = hourly(P.relativeHumidity, t0, n);
  const ws = hourly(P.windSpeed, t0, n), wg = hourly(P.windGust, t0, n), wd = hourly(P.windDirection, t0, n);
  const sky = hourly(P.skyCover, t0, n), pop = hourly(P.probabilityOfPrecipitation, t0, n);
  const qpf = hourly(P.quantitativePrecipitation, t0, n, true), vis = hourly(P.visibility, t0, n), wx = hourly(P.weather, t0, n);
  // Wind aloft: 1/7 power law from the 10 m wind. (80/10)^(1/7) = 1.346, (120/10)^(1/7) = 1.426
  const H = { time: [], temperature_2m: [], dew_point_2m: [], relative_humidity_2m: [], precipitation_probability: [], precipitation: [], weather_code: [],
    cloud_cover_low: [], visibility: [], wind_speed_10m: [], wind_direction_10m: [], wind_gusts_10m: [], wind_speed_80m: [], wind_direction_80m: [], wind_speed_120m: [], wind_direction_120m: [] };
  for (let i = 0; i < n; i++) {
    const loc = new Date(t0 + i * 3600e3 + off * 1000).toISOString().slice(0, 16);
    const s10 = kmh(ws[i]);
    H.time.push(loc);
    H.temperature_2m.push(cToF(temp[i])); H.dew_point_2m.push(cToF(dew[i])); H.relative_humidity_2m.push(rh[i]);
    H.precipitation_probability.push(pop[i] == null ? 0 : pop[i]);
    H.precipitation.push(qpf[i] == null ? 0 : Math.round(qpf[i] / 25.4 * 100) / 100);
    H.weather_code.push(wmoCode(wx[i], sky[i]));
    H.cloud_cover_low.push(sky[i] == null ? null : Math.round(sky[i]));
    H.visibility.push(vis[i] == null ? null : Math.round(vis[i]));
    H.wind_speed_10m.push(s10); H.wind_direction_10m.push(wd[i]);
    H.wind_gusts_10m.push(wg[i] == null ? s10 : kmh(wg[i]));
    H.wind_speed_80m.push(s10 == null ? null : Math.round(s10 * 1.346 * 10) / 10); H.wind_direction_80m.push(wd[i]);
    H.wind_speed_120m.push(s10 == null ? null : Math.round(s10 * 1.426 * 10) / 10); H.wind_direction_120m.push(wd[i]);
  }
  const c = {};
  ['temperature_2m', 'relative_humidity_2m', 'weather_code', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'visibility', 'cloud_cover_low', 'precipitation']
    .forEach(k => { c[k] = H[k][0]; });
  c.time = H.time[0];
  return { source: 'nws', aloftEstimated: true, latitude: lat, longitude: lng, timezone: pt.tz, utc_offset_seconds: off,
    updated: P.updateTime || null, current: c, hourly: H };
}

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const src = String(req.query.src || '');
  if (src === 'forecast') {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.statusCode = 400; return res.end(JSON.stringify({ error: 'lat and lng required' }));
    }
    try {
      const j = await nwsForecast(lat, lng);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=300');
      return res.end(JSON.stringify(j));
    } catch (e) {
      console.error('forecast failed', e && e.message);
      res.statusCode = 502; res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ error: 'Forecast did not respond: ' + (e && e.message ? e.message : 'unknown') }));
    }
  }
  if (src === 'elev') {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'lat and lng required' })); }
    try {
      const j = await getJson(EPQS + '?x=' + lng.toFixed(6) + '&y=' + lat.toFixed(6) + '&units=Meters&wkid=4326&includeDate=false', 9000);
      const m = j && Number(j.value);
      if (!Number.isFinite(m) || m < -500 || m > 9000) throw new Error('no elevation value');
      res.setHeader('Cache-Control', 'public, s-maxage=2592000');
      return res.end(JSON.stringify({ elevation: [m], source: 'USGS 3DEP' }));
    } catch (e) {
      res.statusCode = 502; res.setHeader('Cache-Control', 'no-store');
      return res.end(JSON.stringify({ error: 'Elevation did not respond' }));
    }
  }
  if (src === 'layer') {
    const def = TILE_LAYERS[String(req.query.layer || '')];
    const z = parseInt(req.query.z, 10), x = parseInt(req.query.x, 10), y = parseInt(req.query.y, 10), n = Math.pow(2, z);
    if (!def || z !== def.z || !(x >= 0 && x < n && y >= 0 && y < n)) {
      res.statusCode = 400;
      return res.end(JSON.stringify({ error: 'Unknown layer or tile. Layers: ' + Object.keys(TILE_LAYERS).join(', ') }));
    }
    try {
      const features = await arcTile(def, tileBbox(z, x, y));
      res.setHeader('Cache-Control', 'public, s-maxage=43200, stale-while-revalidate=86400');
      return res.end(JSON.stringify({ type: 'FeatureCollection', features }));
    } catch (e) {
      console.error('layer tile failed', req.query.layer, z, x, y, e && e.code, e && e.message);
      res.statusCode = e && e.code === 429 ? 503 : 502;
      res.setHeader('Cache-Control', 'no-store');
      if (e && e.code === 429) res.setHeader('Retry-After', '60');
      return res.end(JSON.stringify({ error: 'FAA layer did not respond: ' + (e && e.message ? e.message : 'unknown') }));
    }
  }
  const bbox = parseBbox(req.query.bbox);
  if (!bbox || (src !== 'tfr' && src !== 'metar' && src !== 'taf')) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Use src=tfr, src=metar or src=taf with bbox=minLng,minLat,maxLng,maxLat (at most 12 by 8 degrees).' }));
  }
  try {
    if (src === 'tfr') {
      if (!tfrCache.features || Date.now() - tfrCache.t > TFR_TTL_MS) {
        const j = await getJson(TFR_URL, 15000);
        if (!j || !Array.isArray(j.features)) throw new Error('unexpected TFR response');
        tfrCache = { t: Date.now(), features: j.features };
      }
      const [x0, y0, x1, y1] = bbox;
      const hits = tfrCache.features.filter(f => {
        const b = featureBounds(f.geometry);
        return !(b[2] < x0 || b[0] > x1 || b[3] < y0 || b[1] > y1);
      });
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=120');
      return res.end(JSON.stringify({ type: 'FeatureCollection', fetched: new Date(tfrCache.t).toISOString(), total: tfrCache.features.length, features: hits }));
    }
    const [x0, y0, x1, y1] = bbox;
    if (src === 'taf') {
      const t = await getJson(TAF_URL + [y0, x0, y1, x1].map(n => n.toFixed(3)).join(','), 12000);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=300');
      return res.end(JSON.stringify({ fetched: new Date().toISOString(), tafs: Array.isArray(t) ? t : [] }));
    }
    const j = await getJson(METAR_URL + [y0, x0, y1, x1].map(n => n.toFixed(3)).join(','), 12000);
    res.setHeader('Cache-Control', 'public, s-maxage=120, stale-while-revalidate=60');
    return res.end(JSON.stringify({ fetched: new Date().toISOString(), metars: Array.isArray(j) ? j : [] }));
  } catch (e) {
    console.error('relay failed', src, e && e.message);
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'FAA source did not respond: ' + (e && e.message ? e.message : 'unknown') }));
  }
};
