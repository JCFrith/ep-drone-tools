/* Enhanced Patrol FAA relay.
   Two FAA sources refuse browser requests from other sites (no CORS), so the tools call them through
   this function instead. It is not an open proxy: the upstream URLs are fixed, the only input is a
   bounding box, and responses are cached at the edge.
     GET /api/faa?src=tfr&bbox=minLng,minLat,maxLng,maxLat    TFR shapes (FAA tfr.faa.gov) touching the box
     GET /api/faa?src=metar&bbox=minLng,minLat,maxLng,maxLat  Current METARs (aviationweather.gov) in the box
     GET /api/faa?src=layer&layer=KEY&z=Z&x=X&y=Y              One map tile of an FAA airspace layer as GeoJSON
     GET /api/faa?src=forecast&lat=LAT&lng=LNG                 Open-Meteo point forecast (fixed fields), cached 10 min.
       Browsers on some networks wait 20 s or more for a cold connection to Open-Meteo; the edge does not.
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
const UA = 'EnhancedPatrol-SiteTools/1.0 (ep-drone-tools.vercel.app)';
// Open-Meteo: the free endpoint is licensed for non-commercial use only. Set OPEN_METEO_API_KEY in the
// Vercel project to use the paid customer endpoint (commercial licence, reserved capacity).
const OM_KEY_RAW = process.env.OPEN_METEO_API_KEY || '';
const OM_HOST = OM_KEY_RAW ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com';
const OM_KEY = OM_KEY_RAW ? 'apikey=' + encodeURIComponent(OM_KEY_RAW) + '&' : '';
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

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const src = String(req.query.src || '');
  if (src === 'forecast') {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      res.statusCode = 400; return res.end(JSON.stringify({ error: 'lat and lng required' }));
    }
    const url = OM_HOST + '/v1/forecast?' + OM_KEY + 'latitude=' + lat.toFixed(3) + '&longitude=' + lng.toFixed(3) +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover_low,precipitation' +
      '&hourly=temperature_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover_low,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,wind_speed_120m,wind_direction_120m' +
      '&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=2';
    try {
      const j = await retry(function () { return getJson(url, 10000); }, [1200, 3500]);
      if (!j || !j.hourly) throw new Error('unexpected forecast response');
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
      const j = await retry(function () { return getJson(OM_HOST + '/v1/elevation?' + OM_KEY + 'latitude=' + lat.toFixed(5) + '&longitude=' + lng.toFixed(5), 8000); }, [1000]);
      res.setHeader('Cache-Control', 'public, s-maxage=2592000');
      return res.end(JSON.stringify(j));
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
  if (!bbox || (src !== 'tfr' && src !== 'metar')) {
    res.statusCode = 400;
    return res.end(JSON.stringify({ error: 'Use src=tfr or src=metar with bbox=minLng,minLat,maxLng,maxLat (at most 12 by 8 degrees).' }));
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
