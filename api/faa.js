/* Enhanced Patrol FAA relay.
   Two FAA sources refuse browser requests from other sites (no CORS), so the tools call them through
   this function instead. It is not an open proxy: the upstream URLs are fixed, the only input is a
   bounding box, and responses are cached at the edge.
     GET /api/faa?src=tfr&bbox=minLng,minLat,maxLng,maxLat    TFR shapes (FAA tfr.faa.gov) touching the box
     GET /api/faa?src=metar&bbox=minLng,minLat,maxLng,maxLat  Current METARs (aviationweather.gov) in the box */
const TFR_URL = 'https://tfr.faa.gov/geoserver/TFR/ows?service=WFS&version=1.1.0&request=GetFeature' +
  '&typeName=TFR:V_TFR_LOC&outputFormat=application/json&srsname=EPSG:4326' +
  '&propertyName=NOTAM_KEY,TITLE,STATE,LEGAL,CNS_LOCATION_ID,LAST_MODIFICATION_DATETIME,SHAPE';
const METAR_URL = 'https://aviationweather.gov/api/data/metar?format=json&bbox=';
const UA = 'EnhancedPatrol-SiteTools/1.0 (ep-drone-tools.vercel.app)';
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
    res.statusCode = 502;
    res.setHeader('Cache-Control', 'no-store');
    return res.end(JSON.stringify({ error: 'FAA source did not respond: ' + (e && e.message ? e.message : 'unknown') }));
  }
};
