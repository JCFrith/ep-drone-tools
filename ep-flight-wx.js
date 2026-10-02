/* Enhanced Patrol: flight-day weather for one point, shared by the Airspace & Weather page and the
   site assessment Go / No-Go panel.
   Sources: National Weather Service forecast grid through the relay (surface wind; 80 m and 120 m wind is an
   estimate from a standard wind-shear profile), National Weather Service active alerts,
   and aviationweather.gov METARs and TAFs through the EP relay (/api/faa). Sun times are computed locally.
   The indicators only inform the RPIC. They never decide GO. */
(function () {
  'use strict';
  var WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms, hail', 99: 'Thunderstorms, hail' };
  var WET = [45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  var METAR_NEAR_MI = 15;
  var TAF_NEAR_MI = 30;   // a TAF covers about 5 SM around its airport; past 30 mi treat it as regional only
  var RELAY = (typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) ? '/api/faa' : null;

  function esc(v) { return String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function timed(url, ms, opts) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || 12000);
    var o = opts || {}; if (ctl) o.signal = ctl.signal;
    return fetch(url, o).then(function (r) { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(t); throw e; });
  }
  function distMi(a, b, c, d) {
    var R = 3958.7613, r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r;
    var h = Math.sin(x / 2) * Math.sin(x / 2) + Math.cos(a * r) * Math.cos(c * r) * Math.sin(y / 2) * Math.sin(y / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }
  function compass(d) { if (d == null || isNaN(d)) return ''; return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16]; }
  function arrow(d) { return d == null ? '' : '<span class="wx-arrow" style="transform:rotate(' + ((d + 180) % 360) + 'deg)" title="from ' + compass(d) + '">&#8593;</span>'; }

  /* ---- Sun (NOAA sunrise equation). h0 = -0.833 sunrise/sunset, -6 civil twilight ---- */
  function sunEvent(lat, lng, y, m, d, h0) {
    var r = Math.PI / 180, n = Math.round(Date.UTC(y, m - 1, d, 12) / 864e5 + 2440587.5 - 2451545 + 0.0008);
    var Js = n - lng / 360, M = (357.5291 + 0.98560028 * Js) % 360, C = 1.9148 * Math.sin(M * r) + 0.02 * Math.sin(2 * M * r) + 0.0003 * Math.sin(3 * M * r);
    var lam = (M + C + 180 + 102.9372) % 360, Jt = 2451545 + Js + 0.0053 * Math.sin(M * r) - 0.0069 * Math.sin(2 * lam * r);
    var dec = Math.asin(Math.sin(lam * r) * Math.sin(23.4397 * r));
    var cw = (Math.sin(h0 * r) - Math.sin(lat * r) * Math.sin(dec)) / (Math.cos(lat * r) * Math.cos(dec));
    if (cw < -1 || cw > 1) return null;
    var w = Math.acos(cw) / r, toDate = function (J) { return new Date((J - 2440587.5) * 864e5); };
    return { rise: toDate(Jt - w / 360), set: toDate(Jt + w / 360) };
  }
  function offsetOf(W) { return (W && W.fc && W.fc.utc_offset_seconds != null) ? W.fc.utc_offset_seconds : -new Date().getTimezoneOffset() * 60; }
  function sunToday(W) {
    var off = offsetOf(W), loc = new Date(Date.now() + off * 1000), y = loc.getUTCFullYear(), m = loc.getUTCMonth() + 1, d = loc.getUTCDate();
    return { sr: sunEvent(W.lat, W.lng, y, m, d, -0.833), cv: sunEvent(W.lat, W.lng, y, m, d, -6), off: off };
  }
  function fmtLocal(d, off) { if (!d) return 'None'; var t = new Date(d.getTime() + off * 1000), h = t.getUTCHours(), mi = t.getUTCMinutes(); return ((h % 12) || 12) + ':' + (mi < 10 ? '0' : '') + mi + (h < 12 ? ' am' : ' pm'); }
  function hourLabel(iso) { var h = parseInt(iso.slice(11, 13), 10); return ((h % 12) || 12) + (h < 12 ? ' am' : ' pm'); }

  /* ---- Fetch everything for a point. Each source can fail on its own. ---- */
  function fetchAll(lat, lng) {
    var W = { lat: lat, lng: lng, at: new Date().toISOString(), fc: null, alerts: null, metars: null, errors: {} };
    // Forecast only through the relay: it reshapes the NWS grid. There is no direct fallback.
    var d = 0.75, k = Math.cos(lat * Math.PI / 180);
    var bb = [lng - d / k, lat - d, lng + d / k, lat + d].map(function (n) { return n.toFixed(3); }).join(',');
    var d2 = 1.5, bb2 = [lng - d2 / k, lat - d2, lng + d2 / k, lat + d2].map(function (n) { return n.toFixed(3); }).join(',');
    W.tafs = null;
    return Promise.all([
      (RELAY ? timed(RELAY + '?src=forecast&lat=' + lat.toFixed(3) + '&lng=' + lng.toFixed(3), 25000) : Promise.reject(new Error('relay unavailable')))
        .then(function (j) { W.fc = j; }, function (e) { W.errors.fc = e.message || 'failed'; }),
      timed('https://api.weather.gov/alerts/active?point=' + lat.toFixed(4) + ',' + lng.toFixed(4), 12000, { headers: { Accept: 'application/geo+json' } })
        .then(function (j) { W.alerts = (j.features || []).map(function (f) { var p = f.properties || {}; return { event: p.event, severity: p.severity, headline: p.headline, ends: p.ends || p.expires }; }); },
          function (e) { W.errors.alerts = e.message || 'failed'; }),
      (RELAY ? timed(RELAY + '?src=metar&bbox=' + bb) : Promise.reject(new Error('relay unavailable')))
        .then(function (j) {
          W.metars = (j.metars || []).map(function (m) { m._mi = distMi(lat, lng, m.lat, m.lon); return m; }).sort(function (a, b) { return a._mi - b._mi; }).slice(0, 3);
        }, function (e) { W.errors.metar = e.message || 'failed'; }),
      // TAFs are only issued for larger airports, so search a wider box (about 100 mi) and keep the nearest two
      (RELAY ? timed(RELAY + '?src=taf&bbox=' + bb2) : Promise.reject(new Error('relay unavailable')))
        .then(function (j) {
          W.tafs = (j.tafs || []).map(function (t) { t._mi = distMi(lat, lng, t.lat, t.lon); return t; }).sort(function (a, b) { return a._mi - b._mi; }).slice(0, 2);
        }, function (e) { W.errors.taf = e.message || 'failed'; })
    ]).then(function () { return W; });
  }

  function nowIndex(fc) {
    var H = fc && fc.hourly; if (!H || !H.time) return 0;
    var iso = new Date(Date.now() + (fc.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13);
    for (var i = 0; i < H.time.length; i++) if (H.time[i].slice(0, 13) >= iso) return i;
    return 0;
  }
  /* Level at or above the planned altitude: 10 m is 33 ft, 80 m is 262 ft, 120 m is 394 ft.
     NWS forecasts wind at 10 m only; 80 m and 120 m are estimated (1/7 power law), so they are labelled est. */
  function windAtAlt(fc, i, altFt) {
    var H = fc.hourly;
    if (altFt == null || altFt <= 33) return { spd: H.wind_speed_10m[i], dir: H.wind_direction_10m[i], level: '10 m' };
    if (altFt <= 262) return { spd: Math.max(H.wind_speed_10m[i], H.wind_speed_80m[i]), dir: H.wind_direction_80m[i], level: '80 m est.' };
    return { spd: Math.max(H.wind_speed_80m[i], H.wind_speed_120m[i]), dir: H.wind_direction_120m[i], level: '120 m est.' };
  }
  function metarInfo(m) {
    if (!m) return null;
    var vis = m.visib === '10+' ? 10 : parseFloat(m.visib);
    var ceil = null;
    (m.clouds || []).forEach(function (c) { if (/BKN|OVC|OVX|VV/.test(c.cover || '') && c.base != null && (ceil === null || c.base < ceil)) ceil = c.base; });
    var raw = String(m.rawOb || ''), body = raw.split(' RMK')[0];
    return {
      id: m.icaoId, name: m.name, mi: m._mi, raw: raw, fltCat: m.fltCat || '',
      visSM: isNaN(vis) ? null : vis, ceilingFt: ceil,
      ts: /(^|\s)[-+]?(VC)?TS/.test(body),
      precip: /(^|\s)[-+]?(VC)?(SH|FZ)?(RA|SN|DZ|GR|GS|PL|SG|IC|UP)/.test(body),
      obscured: /(^|\s)(FG|BR|HZ|FU|DU|SA|VA)(\s|$)/.test(body),
      ageMin: m.obsTime ? Math.round((Date.now() / 1000 - m.obsTime) / 60) : null
    };
  }

  /* ---- Aviation weather decoding (METAR and TAF JSON from aviationweather.gov) ---- */
  var KT_MPH = 1.15078;
  function parseVis(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var t = String(v).trim().replace(/SM$/i, ''), plus = /\+$/.test(t); t = t.replace(/\+$/, '');
    var n = 0, parts = t.split(/\s+/);
    for (var i = 0; i < parts.length; i++) {
      var f = parts[i].split('/');
      n += f.length === 2 ? parseFloat(f[0]) / parseFloat(f[1]) : parseFloat(parts[i]);
    }
    return isNaN(n) ? null : { v: n, plus: plus };
  }
  function visNum(v) { var p = parseVis(v); return p == null ? null : typeof p === 'number' ? p : p.v; }
  function visText(v) { var p = parseVis(v); if (p == null) return 'n/a'; if (typeof p === 'number') p = { v: p, plus: false };
    var w = Math.floor(p.v), fr = p.v - w, fs = fr > 0.7 ? '3/4' : fr > 0.4 ? '1/2' : fr > 0.1 ? '1/4' : '';
    return (p.plus ? 'More than ' : '') + (w ? w + (fs ? ' ' + fs : '') : (fs || '0')) + ' SM'; }
  function ceilingOf(clouds, vertVis) {
    var c = null;
    (clouds || []).forEach(function (x) { if (/BKN|OVC|OVX|VV/.test(x.cover || '') && x.base != null && (c === null || x.base < c)) c = x.base; });
    if (vertVis != null && (c === null || vertVis < c)) c = vertVis;
    return c;
  }
  function cloudsText(clouds, vertVis) {
    var out = (clouds || []).map(function (x) {
      if (x.cover === 'CLR' || x.cover === 'SKC' || x.cover === 'NCD' || x.cover === 'NSC') return 'Clear';
      if (x.cover === 'CAVOK') return 'CAVOK';
      return x.cover + (x.base != null ? ' ' + Number(x.base).toLocaleString('en-US') : '') + (x.type ? ' ' + x.type : '');
    });
    if (vertVis != null) out.push('VV ' + Number(vertVis).toLocaleString('en-US'));
    return out.length ? out.join(', ') : 'n/a';
  }
  function flightCat(ceil, vis) {
    if ((ceil != null && ceil < 500) || (vis != null && vis < 1)) return 'LIFR';
    if ((ceil != null && ceil < 1000) || (vis != null && vis < 3)) return 'IFR';
    if ((ceil != null && ceil <= 3000) || (vis != null && vis <= 5)) return 'MVFR';
    return 'VFR';
  }
  function windText(dir, spd, gst) {
    if (spd == null) return 'n/a';
    if (Number(spd) === 0) return 'Calm';
    var d = dir === 'VRB' || dir == null ? 'Variable' : String(dir).padStart(3, '0') + '&deg;';
    var kt = spd + (gst ? 'G' + gst : '') + ' kt', mph = Math.round(spd * KT_MPH) + (gst ? 'G' + Math.round(gst * KT_MPH) : '') + ' mph';
    return d + ' ' + kt + ' <span class="wx-mute">(' + mph + ')</span>';
  }
  var WXW = { TS: 'thunderstorm', RA: 'rain', SN: 'snow', DZ: 'drizzle', GR: 'hail', GS: 'small hail', PL: 'ice pellets', SG: 'snow grains', IC: 'ice crystals', UP: 'unknown precip',
    BR: 'mist', FG: 'fog', HZ: 'haze', FU: 'smoke', DU: 'dust', SA: 'sand', VA: 'volcanic ash', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm', DS: 'duststorm', PO: 'dust whirls' };
  var WXD = { SH: 'showers', FZ: 'freezing', BL: 'blowing', DR: 'drifting', MI: 'shallow', BC: 'patchy', PR: 'partial' };
  function wxText(str) {
    if (!str) return '';
    return String(str).split(/\s+/).map(function (tok) {
      if (tok === 'NSW') return 'no significant weather';
      var m = /^([-+]?)(VC)?(MI|PR|BC|DR|BL|SH|TS|FZ)?((?:RA|SN|DZ|GR|GS|PL|SG|IC|UP|BR|FG|HZ|FU|DU|SA|VA|SQ|FC|SS|DS|PO)*)$/.exec(tok);
      if (!m) return tok;
      var words = [], ph = m[4].match(/../g) || [], inten = m[1] === '-' ? 'light' : m[1] === '+' ? 'heavy' : '';
      var phw = ph.map(function (p) { return WXW[p] || p; }).join(' and ');
      if (m[3] === 'TS') words.push(ph.length ? 'thunderstorm with ' + (inten ? inten + ' ' : '') + phw : (inten ? inten + ' ' : '') + 'thunderstorm');
      else { if (inten) words.push(inten); if (m[3]) words.push(WXD[m[3]] || m[3]); words.push(phw); }
      if (m[2]) words.push('in the vicinity');
      return words.filter(Boolean).join(' ').replace(/^(\w+) showers (\w+)/, '$1 $2 showers');
    }).join(', ');
  }
  function hasTS(str) { return /(^|\s)[-+]?(VC)?TS/.test(String(str || '')); }
  function tzLabel(epochSec, off) {
    var t = new Date(epochSec * 1000 + off * 1000), h = t.getUTCHours();
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][t.getUTCDay()] + ' ' + ((h % 12) || 12) + (h < 12 ? ' am' : ' pm');
  }
  function zLabel(epochSec) { var t = new Date(epochSec * 1000); return String(t.getUTCDate()).padStart(2, '0') + String(t.getUTCHours()).padStart(2, '0') + 'Z'; }
  function tafPeriods(t) {
    return (t.fcsts || []).map(function (f) {
      var vis = visNum(f.visib), ceil = ceilingOf(f.clouds, f.vertVis);
      var kind = f.fcstChange === 'FM' ? 'From' : f.fcstChange === 'TEMPO' ? 'Temporary' : f.fcstChange === 'BECMG' ? 'Becoming' : f.fcstChange === 'PROB' ? 'Chance' : f.fcstChange ? f.fcstChange : 'Initial';
      if (f.probability) kind = (f.fcstChange === 'TEMPO' ? 'Temporary, ' : '') + f.probability + '% chance';
      return { from: f.timeFrom, to: f.timeTo, kind: kind, temp: f.fcstChange === 'TEMPO' || !!f.probability, wdir: f.wdir, wspd: f.wspd, wgst: f.wgst, vis: vis, visRaw: f.visib,
        ceil: ceil, clouds: f.clouds, vertVis: f.vertVis, wx: f.wxString || '', ts: hasTS(f.wxString), cat: (vis == null && ceil == null) ? '' : flightCat(ceil, vis),
        llws: f.wshearHgt != null ? 'Wind shear ' + (f.wshearHgt * 100) + ' ft ' + f.wshearDir + '&deg; ' + f.wshearSpd + ' kt' : '' };
    });
  }
  /* Worst forecast condition at the nearest TAF over the next `hours`. */
  function tafOutlook(W, hours) {
    var t = (W.tafs || []).filter(function (x) { return x._mi <= TAF_NEAR_MI; })[0];
    if (!t) return null;
    var now = Date.now() / 1000, end = now + (hours || 3) * 3600, rank = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
    var hit = tafPeriods(t).filter(function (p) { return p.from < end && p.to > now; });
    var worst = hit.reduce(function (a, p) { return p.cat && (!a || rank[p.cat] > rank[a]) ? p.cat : a; }, '');
    var maxG = hit.reduce(function (a, p) { return Math.max(a, p.wgst || p.wspd || 0); }, 0);
    return { id: t.icaoId, mi: t._mi, ts: hit.some(function (p) { return p.ts; }), cat: worst, maxKt: maxG, minVis: hit.reduce(function (a, p) { return p.vis != null && (a == null || p.vis < a) ? p.vis : a; }, null) };
  }

  /* ---- Aircraft limits against the weather now: max wind, max gust, temperature range ----
     Green below 80% of the limit (temperature: more than 5 F inside the range), yellow from 80% or when the
     next 2 hours reach the limit, red at or past the limit. "Now" takes the worse of the forecast for this
     hour and the nearest METAR within 15 mi. Sustained wind is at the planned altitude (estimated above 10 m). */
  function limitsCheck(W, ctx) {
    ctx = ctx || {};
    var fc = W.fc, H = fc && fc.hourly, i = fc ? nowIndex(fc) : 0, alt = ctx.plannedAltFt != null ? ctx.plannedAltFt : null;
    var near = (W.metars || []).filter(function (m) { return m && m._mi <= METAR_NEAR_MI; })[0] || null;
    var rows = [];
    var lvl = function (v, lim, soon) { if (v == null || lim == null) return 'warn'; return v >= lim ? 'no' : (v >= 0.8 * lim || (soon != null && soon >= lim)) ? 'warn' : 'ok'; };
    // Sustained wind
    var wl = ctx.windLimit != null ? Number(ctx.windLimit) : null, wNow = null, wSrc = [], wSoon = null;
    if (fc && H) { var wa = windAtAlt(fc, i, alt); wNow = wa.spd; wSrc.push('forecast ' + wa.level);
      for (var k = i + 1; k <= Math.min(i + 2, H.time.length - 1); k++) wSoon = Math.max(wSoon || 0, windAtAlt(fc, k, alt).spd); }
    if (near && near.wspd != null) { var ms = near.wspd * KT_MPH; if (wNow == null || ms > wNow) wNow = ms; wSrc.push(near.icaoId + ' observed'); }
    rows.push({ key: 'wind', label: 'Max wind', limit: wl, now: wNow == null ? null : Math.round(wNow), unit: 'mph', source: wSrc.join(', '), level: lvl(wNow, wl, wSoon),
      detail: wl == null ? 'No aircraft max wind on record.' : wNow == null ? 'Wind unavailable.' : wNow >= wl ? 'At or above the aircraft max wind.' : (wSoon != null && wSoon >= wl) ? 'Forecast to reach ' + Math.round(wSoon) + ' mph within 2 hours.' : wNow >= 0.8 * wl ? 'Within 20% of the aircraft max wind.' : 'Below 80% of the aircraft max wind.' });
    // Gusts
    var gl = ctx.gustLimit != null ? Number(ctx.gustLimit) : wl, gNow = null, gSrc = [], gSoon = null;
    if (fc && H) { gNow = H.wind_gusts_10m[i]; gSrc.push('forecast');
      for (var q = i + 1; q <= Math.min(i + 2, H.time.length - 1); q++) gSoon = Math.max(gSoon || 0, H.wind_gusts_10m[q] || 0); }
    if (near) { var mg = (near.wgst || near.wspd || 0) * KT_MPH; if (gNow == null || mg > gNow) gNow = mg; gSrc.push(near.icaoId + ' observed'); }
    rows.push({ key: 'gust', label: 'Max gust', limit: gl, now: gNow == null ? null : Math.round(gNow), unit: 'mph', source: gSrc.join(', '), level: lvl(gNow, gl, gSoon),
      detail: (ctx.gustLimit == null && wl != null ? 'No separate gust limit on record; using the max wind. ' : '') + (gl == null ? 'No aircraft gust limit on record.' : gNow == null ? 'Gusts unavailable.' : gNow >= gl ? 'At or above the aircraft gust limit.' : (gSoon != null && gSoon >= gl) ? 'Forecast gusts reach ' + Math.round(gSoon) + ' mph within 2 hours.' : gNow >= 0.8 * gl ? 'Within 20% of the gust limit.' : 'Below 80% of the gust limit.') });
    // Temperature
    var lo = ctx.tempMin != null ? Number(ctx.tempMin) : null, hi = ctx.tempMax != null ? Number(ctx.tempMax) : null, T = null, tSrc = '';
    if (near && near.temp != null) { T = near.temp * 9 / 5 + 32; tSrc = near.icaoId + ' observed'; }
    else if (fc && fc.current && fc.current.temperature_2m != null) { T = fc.current.temperature_2m; tSrc = 'forecast'; }
    var tl = (lo == null && hi == null) || T == null ? 'warn' : ((lo != null && T < lo) || (hi != null && T > hi)) ? 'no' : ((lo != null && T < lo + 5) || (hi != null && T > hi - 5)) ? 'warn' : 'ok';
    rows.push({ key: 'temp', label: 'Temperature range', limit: (lo == null && hi == null) ? null : (lo != null ? lo : '?') + ' to ' + (hi != null ? hi : '?'), now: T == null ? null : Math.round(T), unit: '\u00b0F', source: tSrc, level: tl,
      detail: (lo == null && hi == null) ? 'No aircraft temperature range on record.' : T == null ? 'Temperature unavailable.' : tl === 'no' ? 'Outside the aircraft operating range.' : tl === 'warn' ? 'Within 5\u00b0F of the aircraft operating limit.' : 'Inside the aircraft operating range.' });
    return rows;
  }
  function limitsHTML(rows, link) {
    var name = { ok: 'GREEN', warn: 'YELLOW', no: 'RED' };
    return '<table class="wx-lim"><thead><tr><th>Aircraft limit</th><th>Limit</th><th>Now</th><th>Rating</th></tr></thead><tbody>' + rows.map(function (r) {
      return '<tr class="' + r.level + '"><td><b>' + jump(r.label, link && link(r.key)) + '</b><div class="wx-mute">' + esc(r.detail) + '</div></td>' +
        '<td>' + (r.limit == null ? '<span class="wx-mute">Not set</span>' : esc(r.limit) + ' ' + r.unit) + '</td>' +
        '<td>' + (r.now == null ? '<span class="wx-mute">n/a</span>' : r.now + ' ' + r.unit) + (r.source ? '<div class="wx-mute">' + esc(r.source) + '</div>' : '') + '</td>' +
        '<td><span class="wx-rate ' + r.level + '">' + name[r.level] + '</span></td></tr>';
    }).join('') + '</tbody></table>';
  }

  /* ---- Go / No-Go indicators. level: ok | warn | no ---- */
  function evaluate(W, ctx) {
    ctx = ctx || {};
    var out = [], add = function (key, label, level, value, detail) { out.push({ key: key, label: label, level: level, value: value, detail: detail || '' }); };
    var fc = W.fc, i = fc ? nowIndex(fc) : 0, H = fc && fc.hourly;
    var alt = ctx.plannedAltFt != null ? ctx.plannedAltFt : null, lim = ctx.windLimit;
    var near = (W.metars || []).map(metarInfo).filter(function (m) { return m && m.mi <= METAR_NEAR_MI; })[0] || null;

    // Aircraft limits: max wind, max gust, temperature range
    limitsCheck(W, ctx).forEach(function (r) {
      add(r.key, r.label, r.level, r.now == null ? 'Unavailable' : r.now + ' ' + r.unit + (r.limit != null ? ' (limit ' + r.limit + ' ' + r.unit + ')' : ''), r.detail);
    });
    // Visibility, 14 CFR 107.51(c): 3 SM
    var vis = near && near.visSM != null ? near.visSM : (fc && fc.current && fc.current.visibility != null ? fc.current.visibility / 1609.34 : null);
    var visSrc = near && near.visSM != null ? near.id + ' METAR' : 'forecast';
    if (vis == null) add('vis', 'Visibility', 'warn', 'Unavailable', 'Confirm at least 3 SM (14 CFR 107.51(c)).');
    else add('vis', 'Visibility', vis < 3 ? 'no' : 'ok', (vis >= 10 ? '10+' : vis.toFixed(1)) + ' SM (' + visSrc + ')', vis < 3 ? 'Below 3 SM, 14 CFR 107.51(c).' : 'At least 3 SM, 14 CFR 107.51(c).');
    // Cloud clearance, 107.51(d)(1): 500 ft below clouds
    if (near) {
      var need = (alt || 0) + 500;
      if (near.ceilingFt === null) add('ceiling', 'Ceiling', 'ok', 'None reported (' + near.id + ', ' + near.mi.toFixed(0) + ' mi)', 'No broken or overcast layer.');
      else add('ceiling', 'Ceiling', near.ceilingFt < need ? 'no' : near.ceilingFt < need + 500 ? 'warn' : 'ok',
        near.ceilingFt.toLocaleString('en-US') + ' ft (' + near.id + ', ' + near.mi.toFixed(0) + ' mi)',
        'Needs ' + need + ' ft: planned ' + (alt || 0) + ' ft plus 500 ft below clouds, 14 CFR 107.51(d)(1). Station ceiling is above that station, not this site.');
    } else if (fc && fc.current && fc.current.cloud_cover_low >= 70) add('ceiling', 'Ceiling', 'warn', 'Sky cover ' + fc.current.cloud_cover_low + '% (forecast)', 'No METAR within ' + METAR_NEAR_MI + ' mi. Confirm 500 ft below clouds, 14 CFR 107.51(d)(1).');
    else add('ceiling', 'Ceiling', 'warn', 'No nearby METAR', 'No station within ' + METAR_NEAR_MI + ' mi. Confirm 500 ft below clouds, 14 CFR 107.51(d)(1).');
    // Thunderstorms (the available proxy for lightning within 10 NM)
    var tsFc = false; if (fc) for (var t = i; t <= Math.min(i + 2, H.time.length - 1); t++) if (H.weather_code[t] >= 95) tsFc = true;
    var tsObs = (W.metars || []).map(metarInfo).some(function (m) { return m && m.ts && m.mi <= 12; });
    add('storm', 'Thunderstorms', (tsFc || tsObs) ? 'no' : 'ok', tsObs ? 'Reported nearby' : tsFc ? 'Forecast within 2 h' : 'None',
      'EP preflight: no lightning within 10 NM. This checks reported and forecast thunderstorms, not lightning strikes.');
    // Precipitation, fog, smoke, dust (EP preflight checklist)
    var codeNow = fc && fc.current ? fc.current.weather_code : null;
    var wetNow = (codeNow != null && WET.indexOf(codeNow) >= 0) || (near && near.precip);
    var obsc = near && near.obscured;
    var popSoon = 0; if (fc) for (var p = i; p <= Math.min(i + 2, H.time.length - 1); p++) popSoon = Math.max(popSoon, H.precipitation_probability[p] || 0);
    add('precip', 'Precipitation / obscuration', wetNow ? 'no' : (obsc || popSoon >= 50) ? 'warn' : 'ok',
      wetNow ? (WMO[codeNow] || 'Reported') : obsc ? 'Haze, mist or smoke reported' : popSoon + '% chance in 2 h', 'EP preflight: no precipitation, fog, smoke or dust.');
    // Daylight and lighting, 14 CFR 107.29
    var s = sunToday(W), nowMs = Date.now();
    var day = s.cv && nowMs >= s.cv.rise.getTime() && nowMs <= s.cv.set.getTime();
    if (day) add('light', 'Daylight', 'ok', 'Civil twilight ends ' + fmtLocal(s.cv.set, s.off), '');
    else add('light', 'Daylight', ctx.lights === false ? 'no' : 'warn', 'Night (civil dawn ' + fmtLocal(s.cv && s.cv.rise, s.off) + ')',
      ctx.lights === false ? 'Fleet record shows no anti-collision lighting. Night flight needs lighting visible 3 SM, 14 CFR 107.29.' : 'Anti-collision lighting visible 3 SM must be on, 14 CFR 107.29.');
    // NWS alerts
    if (W.alerts === null) add('alerts', 'Weather alerts', 'warn', 'Unavailable', 'National Weather Service alerts did not load.');
    else if (!W.alerts.length) add('alerts', 'Weather alerts', 'ok', 'None active', '');
    else {
      var sev = W.alerts.some(function (a) { return /Extreme|Severe/.test(a.severity || ''); });
      add('alerts', 'Weather alerts', sev ? 'no' : 'warn', W.alerts.map(function (a) { return a.event; }).join(', '), '');
    }
    // TAF: forecast at the nearest terminal, next 3 hours. Forecast only, so it can caution but never block.
    if (W.tafs !== undefined) {
      var o = W.tafs === null ? null : tafOutlook(W, 3);
      if (W.tafs === null) add('taf', 'Terminal forecast', 'warn', 'Unavailable', 'TAFs did not load. Check aviationweather.gov.');
      else if (!o) add('taf', 'Terminal forecast', 'ok', 'No TAF within ' + TAF_NEAR_MI + ' mi', 'Nearest TAF airport is farther away; it describes that airport, not the site.');
      else {
        var glim = ctx.gustLimit != null ? Number(ctx.gustLimit) : lim;
        var bad = o.ts || o.cat === 'IFR' || o.cat === 'LIFR' || (glim != null && o.maxKt * KT_MPH > glim);
        add('taf', 'Terminal forecast', bad ? 'warn' : 'ok',
          o.id + ' (' + o.mi.toFixed(0) + ' mi), next 3 h: ' + (o.cat || 'n/a') + (o.ts ? ', thunderstorms' : '') + (o.maxKt ? ', wind to ' + Math.round(o.maxKt * KT_MPH) + ' mph' : ''),
          o.ts ? 'Thunderstorms forecast at the airport in the next 3 hours.'
            : (o.cat === 'IFR' || o.cat === 'LIFR') ? 'IFR or lower forecast at the airport in the next 3 hours. Check ceiling and visibility at the site.'
            : bad ? 'Forecast wind or gusts above the ' + glim + ' mph limit in the next 3 hours.' : 'Forecast for the airport, not the site.');
      }
    }
    return out;
  }

  /* ---- Renderers ---- */
  function tilesHTML(W, lim, altFt) {
    var fc = W.fc; if (!fc) return '<div class="wx-empty">Forecast unavailable' + (W.errors.fc ? ': ' + esc(W.errors.fc) : '') + '.</div>';
    var c = fc.current || {}, H = fc.hourly, i = nowIndex(fc), lvl = function (v) { return lim != null && v != null && v >= lim ? ' bad' : ''; };
    var vis = function (m) { return m == null ? '' : (m / 1609.34 >= 10 ? '10+' : (m / 1609.34).toFixed(1)); };
    var tile = function (k, v, s, cls) { return '<div class="wx-tile' + (cls || '') + '"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="s">' + s + '</div></div>'; };
    return '<div class="wx-tiles">' +
      tile('Conditions', '<span style="font-size:.86rem">' + esc(WMO[c.weather_code] || '') + '</span>', Math.round(c.temperature_2m) + '&deg;F, ' + c.relative_humidity_2m + '% RH') +
      tile('Wind 10 m', Math.round(c.wind_speed_10m) + ' mph', 'from ' + compass(c.wind_direction_10m) + arrow(c.wind_direction_10m), lvl(c.wind_speed_10m)) +
      tile('Gusts', Math.round(c.wind_gusts_10m) + ' mph', 'surface', lvl(c.wind_gusts_10m)) +
      tile('Wind 80 m est.', Math.round(H.wind_speed_80m[i]) + ' mph', 'about 260 ft, estimated', lvl(H.wind_speed_80m[i])) +
      tile('Wind 120 m est.', Math.round(H.wind_speed_120m[i]) + ' mph', 'about 390 ft, estimated', lvl(H.wind_speed_120m[i])) +
      tile('Visibility', vis(c.visibility) + ' mi', 'sky cover ' + c.cloud_cover_low + '%', (c.visibility != null && c.visibility < 4828) ? ' warn' : '') +
      '</div>';
  }
  function hoursHTML(W, lim, count) {
    var fc = W.fc; if (!fc) return '<div class="wx-empty">Forecast unavailable.</div>';
    var H = fc.hourly, off = fc.utc_offset_seconds || 0, i0 = nowIndex(fc), rows = '';
    var lvl = function (v) { return lim != null && v != null && v >= lim ? 'bad' : ''; };
    var vis = function (m) { return m == null ? '' : (m / 1609.34 >= 10 ? '10+' : (m / 1609.34).toFixed(1)); };
    for (var k = i0; k < Math.min(i0 + (count || 12), H.time.length); k++) {
      var t = H.time[k], ev = sunEvent(W.lat, W.lng, +t.slice(0, 4), +t.slice(5, 7), +t.slice(8, 10), -6);
      var tUtc = Date.parse(t + ':00Z') - off * 1000, night = ev ? (tUtc < ev.rise.getTime() || tUtc > ev.set.getTime()) : false;
      rows += '<tr><td class="' + (night ? 'night' : '') + '">' + hourLabel(t) + (night ? ' &#9790;' : '') + '</td><td>' + esc(WMO[H.weather_code[k]] || '') + '</td>' +
        '<td>' + Math.round(H.temperature_2m[k]) + '&deg;</td><td class="' + (H.precipitation_probability[k] >= 50 ? 'warn' : '') + '">' + H.precipitation_probability[k] + '%</td>' +
        '<td class="' + lvl(H.wind_speed_10m[k]) + '">' + Math.round(H.wind_speed_10m[k]) + arrow(H.wind_direction_10m[k]) + '</td>' +
        '<td class="' + lvl(H.wind_gusts_10m[k]) + '">' + Math.round(H.wind_gusts_10m[k]) + '</td>' +
        '<td class="' + lvl(H.wind_speed_80m[k]) + '">' + Math.round(H.wind_speed_80m[k]) + arrow(H.wind_direction_80m[k]) + '</td>' +
        '<td class="' + lvl(H.wind_speed_120m[k]) + '">' + Math.round(H.wind_speed_120m[k]) + arrow(H.wind_direction_120m[k]) + '</td>' +
        '<td class="' + ((H.visibility[k] != null && H.visibility[k] < 4828) ? 'warn' : '') + '">' + vis(H.visibility[k]) + '</td><td>' + H.cloud_cover_low[k] + '%</td></tr>';
    }
    return '<div class="wx-scroll"><table class="wx-table"><thead><tr><th>Hour</th><th>Sky</th><th>Temp</th><th>Rain</th><th>Wind 10 m</th><th>Gust</th><th>80 m est</th><th>120 m est</th><th>Vis mi</th><th>Sky</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="wx-src">National Weather Service forecast for the site. Winds in mph; the arrow points where the wind is blowing. NWS forecasts wind at 33 ft (10 m) only: the 80 m and 120 m columns are estimates from a standard wind-shear profile and can run low, especially at night and in stable air. &#9790; marks hours outside civil twilight. Local time at the site.</div>';
  }
  function alertsHTML(W) {
    if (W.alerts === null) return '<div class="wx-empty">National Weather Service alerts unavailable (US locations only).</div>';
    if (!W.alerts.length) return '<div class="wx-empty">No active alerts for this point.</div>';
    return W.alerts.map(function (a) {
      return '<div class="wx-alert' + (/Extreme|Severe/.test(a.severity || '') ? ' sev' : '') + '"><b>' + esc(a.event) + '</b>' + (a.severity ? ' (' + esc(a.severity) + ')' : '') + '<div class="wx-src">' + esc(a.headline || '') + '</div></div>';
    }).join('');
  }
  /* ---- Plain-language summaries ---- */
  var COVER = { FEW: 'a few clouds', SCT: 'scattered clouds', BKN: 'broken clouds', OVC: 'overcast', OVX: 'sky obscured', VV: 'sky obscured' };
  function compassWord(d) {
    if (d == null || d === 'VRB') return 'a variable direction';
    var w = { N: 'north', NNE: 'north-northeast', NE: 'northeast', ENE: 'east-northeast', E: 'east', ESE: 'east-southeast', SE: 'southeast', SSE: 'south-southeast',
      S: 'south', SSW: 'south-southwest', SW: 'southwest', WSW: 'west-southwest', W: 'west', WNW: 'west-northwest', NW: 'northwest', NNW: 'north-northwest' };
    return 'the ' + (w[compass(Number(d))] || 'variable direction');
  }
  function windPlain(dir, kt, gkt) {
    if (kt == null) return '';
    if (Number(kt) === 0) return 'calm wind';
    return 'wind from ' + compassWord(dir) + ' at ' + Math.round(kt * KT_MPH) + ' mph' + (gkt ? ' gusting ' + Math.round(gkt * KT_MPH) : '');
  }
  function visPlain(v) {
    var p = parseVis(v); if (p == null) return '';
    if (typeof p === 'number') p = { v: p, plus: false };
    var n = p.v >= 1 ? (Math.round(p.v * 4) / 4) : p.v;
    return 'visibility ' + (p.plus ? 'over ' : '') + (n === 1 ? '1 mile' : (n < 1 ? visText(v).replace(' SM', '') + ' mile' : visText(v).replace(/^More than /, '').replace(' SM', '') + ' miles'));
  }
  function cloudsPlain(clouds, vv) {
    var L = (clouds || []).filter(function (c) { return COVER[c.cover]; }).map(function (c) {
      return COVER[c.cover] + (c.base != null ? ' at ' + Number(c.base).toLocaleString('en-US') + ' ft' : '') + (c.type === 'CB' ? ' (thunderstorm clouds)' : c.type === 'TCU' ? ' (towering cumulus)' : '');
    });
    if (vv != null) L.push('sky obscured, vertical visibility ' + Number(vv).toLocaleString('en-US') + ' ft');
    if (!L.length) return (clouds || []).some(function (c) { return /CLR|SKC|NCD|NSC|CAVOK/.test(c.cover || ''); }) ? 'clear skies' : '';
    return L.join(', ');
  }
  var CAT_PLAIN = { VFR: 'VFR, good flying weather', MVFR: 'marginal VFR', IFR: 'IFR, low ceiling or visibility', LIFR: 'low IFR, very low ceiling or visibility' };
  function metarPlain(x) {
    var parts = [windPlain(x.wdir, x.wspd, x.wgst), visPlain(x.visib), cloudsPlain(x.clouds, x.vertVis)];
    if (x.wxString) parts.push(wxText(x.wxString));
    if (x.temp != null) parts.push(Math.round(x.temp * 9 / 5 + 32) + '&deg;F');
    var s = parts.filter(Boolean).join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1) + '.' + (x.fltCat ? ' ' + (CAT_PLAIN[x.fltCat] || x.fltCat) + '.' : '');
  }
  function periodPlain(p, off) {
    var bits = [];
    if (p.wspd != null) bits.push(windPlain(p.wdir, p.wspd, p.wgst));
    if (p.visRaw != null) bits.push(visPlain(p.visRaw));
    if ((p.clouds && p.clouds.length) || p.vertVis != null) bits.push(cloudsPlain(p.clouds, p.vertVis));
    if (p.wx) bits.push(wxText(p.wx));
    var when = p.kind === 'Initial' ? 'Until ' + tzLabel(p.to, off) : (/chance|Temporary/.test(p.kind) ? p.kind + ' ' : 'From ') + tzLabel(p.from, off) + (/chance|Temporary/.test(p.kind) ? ' to ' + tzLabel(p.to, off) : '');
    return '<b>' + esc(when) + ':</b> ' + esc(bits.filter(Boolean).join(', ') || 'no change') + (p.cat ? ' (' + p.cat + ')' : '') + '.';
  }

  function metarDecoded(x) {
    var vis = visNum(x.visib), ceil = ceilingOf(x.clouds, x.vertVis), cells = [];
    cells.push(['Wind', windText(x.wdir, x.wspd, x.wgst)]);
    cells.push(['Visibility', esc(visText(x.visib))]);
    cells.push(['Ceiling', ceil == null ? 'None' : Number(ceil).toLocaleString('en-US') + ' ft AGL']);
    cells.push(['Clouds', esc(cloudsText(x.clouds, x.vertVis))]);
    if (x.wxString) cells.push(['Weather', esc(wxText(x.wxString))]);
    if (x.temp != null) cells.push(['Temp / dew', Math.round(x.temp * 9 / 5 + 32) + '&deg;F / ' + (x.dewp != null ? Math.round(x.dewp * 9 / 5 + 32) + '&deg;F' : 'n/a')]);
    if (x.altim != null) cells.push(['Altimeter', (x.altim > 100 ? (x.altim * 0.02953).toFixed(2) : Number(x.altim).toFixed(2)) + ' inHg']);
    return '<div class="wx-dec">' + cells.map(function (c) { return '<div><span>' + c[0] + '</span>' + c[1] + '</div>'; }).join('') + '</div>';
  }
  function metarsHTML(W, limit) {
    if (W.metars === null) return '<div class="wx-empty">METARs unavailable right now.</div>';
    if (!W.metars.length) return '<div class="wx-empty">No reporting station within about 50 miles.</div>';
    return W.metars.slice(0, limit || W.metars.length).map(function (x) {
      var m = metarInfo(x);
      return '<div class="wx-metar"><b>' + esc(m.id) + '</b> ' + esc(m.name || '') + ' <span class="wx-src" style="display:inline">' + m.mi.toFixed(1) + ' mi' + (m.ageMin != null ? ', ' + m.ageMin + ' min old' : '') + '</span>' +
        (m.fltCat ? '<span class="wx-fc ' + esc(m.fltCat) + '">' + esc(m.fltCat) + '</span>' : '') + '<div class="wx-plain">' + metarPlain(x) + '</div>' + metarDecoded(x) + '<code>' + esc(m.raw) + '</code></div>';
    }).join('');
  }
  function tafsHTML(W, limit) {
    if (W.tafs === null || W.tafs === undefined) return '<div class="wx-empty">TAFs unavailable right now' + (W.errors && W.errors.taf ? ': ' + esc(W.errors.taf) : '') + '.</div>';
    if (!W.tafs.length) return '<div class="wx-empty">No TAF issued within about 100 miles.</div>';
    var off = offsetOf(W), now = Date.now() / 1000;
    return W.tafs.slice(0, limit || W.tafs.length).map(function (t) {
      var live = tafPeriods(t).filter(function (p) { return p.to > now && p.from < now + 24 * 3600; });
      var plain = '<div class="wx-plain">' + live.map(function (p) { return '<div>' + periodPlain(p, off) + '</div>'; }).join('') + '</div>';
      var rows = tafPeriods(t).filter(function (p) { return p.to > now; }).map(function (p) {
        var cur = p.from <= now && p.to > now;
        return '<tr class="' + (cur ? 'cur' : '') + (p.temp ? ' tmp' : '') + '"><td>' + esc(p.kind) + '<div class="wx-mute">' + tzLabel(p.from, off) + ' to ' + tzLabel(p.to, off) + '<br>' + zLabel(p.from) + ' to ' + zLabel(p.to) + '</div></td>' +
          '<td data-l="Wind">' + (p.wspd == null ? '<span class="wx-mute">no change</span>' : windText(p.wdir, p.wspd, p.wgst)) + (p.llws ? '<div class="wx-warn">' + p.llws + '</div>' : '') + '</td>' +
          '<td data-l="Visibility">' + (p.visRaw == null ? '<span class="wx-mute">no change</span>' : esc(visText(p.visRaw))) + '</td>' +
          '<td data-l="Clouds">' + ((p.clouds && p.clouds.length) || p.vertVis != null ? esc(cloudsText(p.clouds, p.vertVis)) : '<span class="wx-mute">no change</span>') + '</td>' +
          '<td data-l="Weather"' + (p.ts ? ' class="bad"' : '') + (p.wx ? '' : ' data-empty="1"') + '>' + (p.wx ? esc(wxText(p.wx)) : '') + '</td>' +
          '<td data-l="Category">' + (p.cat ? '<span class="wx-fc ' + p.cat + '" style="margin:0">' + p.cat + '</span>' : '') + '</td></tr>';
      }).join('');
      var far = t._mi > TAF_NEAR_MI;
      return '<div class="wx-taf"><b>' + esc(t.icaoId) + '</b> ' + esc(t.name || '') + ' <span class="wx-src" style="display:inline">' + t._mi.toFixed(1) + ' mi' +
        (t.issueTime ? ', issued ' + tzLabel(Date.parse(t.issueTime) / 1000, off) : '') + '</span>' +
        (far ? '<div class="wx-warn">More than ' + TAF_NEAR_MI + ' mi from the site. Treat it as a regional trend only.</div>' : '') + plain +
        '<details class="wx-det"><summary>Decoded table</summary><div class="wx-scroll"><table class="wx-table wx-taf-t"><thead><tr><th>Period (site time, Z)</th><th>Wind</th><th>Visibility</th><th>Clouds (ft AGL)</th><th>Weather</th><th>Cat</th></tr></thead><tbody>' +
        (rows || '<tr><td colspan="6" class="wx-mute">All periods have passed.</td></tr>') + '</tbody></table></div></details><code>' + esc(t.rawTAF || '') + '</code></div>';
    }).join('') + '<div class="wx-src">TAFs from the NWS Aviation Weather Center. A TAF covers about 5 SM around its airport, so conditions at the site can differ. ' +
      'In the decoded table the highlighted row is in effect now and shaded rows are temporary or probable changes. A period without a value carries the prior one forward.</div>';
  }
  /* Raw METAR and TAF text kept with a record, so the reports read later are exactly what was shown. */
  function avwxSnapshot(W, limit) {
    return { at: W.at, lat: W.lat, lng: W.lng,
      metars: (W.metars || []).slice(0, limit || 99).map(function (m) { return { id: m.icaoId, name: m.name || '', mi: Math.round(m._mi * 10) / 10, cat: m.fltCat || '', raw: m.rawOb || '' }; }),
      tafs: (W.tafs || []).slice(0, limit || 99).map(function (t) { return { id: t.icaoId, name: t.name || '', mi: Math.round(t._mi * 10) / 10, issued: t.issueTime || '', raw: t.rawTAF || '' }; }) };
  }
  function avwxSnapshotHTML(snap) {
    if (!snap) return '';
    var f = function (x, raw) { return '<div class="wx-metar"><b>' + esc(x.id) + '</b> ' + esc(x.name) + ' <span class="wx-src" style="display:inline">' + x.mi + ' mi</span>' + (x.cat ? '<span class="wx-fc ' + esc(x.cat) + '">' + esc(x.cat) + '</span>' : '') + '<code>' + esc(raw) + '</code></div>'; };
    return '<div class="fg-label" style="margin-top:6px;">METAR</div>' + ((snap.metars || []).map(function (m) { return f(m, m.raw); }).join('') || '<div class="wx-empty">None</div>') +
      '<div class="fg-label" style="margin-top:6px;">TAF</div>' + ((snap.tafs || []).map(function (t) { return f(t, t.raw); }).join('') || '<div class="wx-empty">None</div>');
  }
  function sunHTML(W) {
    var s = sunToday(W);
    return '<div class="wx-sun"><div><span>Civil dawn</span>' + fmtLocal(s.cv && s.cv.rise, s.off) + '</div><div><span>Sunrise</span>' + fmtLocal(s.sr && s.sr.rise, s.off) +
      '</div><div><span>Sunset</span>' + fmtLocal(s.sr && s.sr.set, s.off) + '</div><div><span>Civil dusk</span>' + fmtLocal(s.cv && s.cv.set, s.off) + '</div></div>' +
      '<div class="wx-src">Today at the site, local time. Outside civil twilight, anti-collision lighting visible 3 SM is required (14 CFR 107.29).</div>';
  }
  /* link(key) may return an element id; the label then jumps to that part of the page. */
  function jump(label, id) { return id ? '<a class="wx-jump" href="#' + id + '" data-jump="' + id + '">' + esc(label) + ' <span aria-hidden="true">&#8250;</span></a>' : esc(label); }
  function itemsHTML(items, link) {
    return '<div class="wx-items">' + items.map(function (x) {
      return '<div class="wx-item ' + x.level + '"><span class="dot"></span><div class="lbl">' + jump(x.label, link && link(x.key)) + '</div><div class="val">' + esc(x.value) +
        (x.detail ? '<div class="det">' + esc(x.detail) + '</div>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  var CSS = '.wx-tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}' +
    '.wx-tile{background:rgba(255,255,255,.03);border-radius:6px;padding:7px 8px;}' +
    '.wx-tile .k{font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:#9A9A9A;} .wx-tile .v{font-size:1rem;font-weight:700;} .wx-tile .s{font-size:.66rem;color:#9A9A9A;}' +
    '.wx-tile.bad .v{color:#E5484D;} .wx-tile.warn .v{color:#F5A524;}' +
    '.wx-scroll{overflow-x:auto;} table.wx-table{border-collapse:collapse;font-size:.74rem;width:100%;min-width:560px;}' +
    'table.wx-table th{color:#9A9A9A;font-weight:600;font-size:.62rem;text-transform:uppercase;letter-spacing:.04em;padding:5px 4px;text-align:right;}' +
    'table.wx-table th:first-child,table.wx-table td:first-child{text-align:left;} table.wx-table td{padding:5px 4px;border-top:1px solid rgba(255,255,255,.06);text-align:right;white-space:nowrap;}' +
    'table.wx-table td.bad{color:#E5484D;font-weight:700;} table.wx-table td.warn{color:#F5A524;} table.wx-table td.night{color:#9A9A9A;}' +
    '.wx-arrow{display:inline-block;font-size:.8em;margin-left:2px;}' +
    '.wx-alert{border-left:3px solid #F5A524;padding:6px 9px;margin-bottom:6px;background:rgba(245,165,36,.07);font-size:.8rem;} .wx-alert.sev{border-color:#E5484D;background:rgba(229,72,77,.08);}' +
    '.wx-metar{font-size:.78rem;margin-bottom:8px;} .wx-metar code{display:block;font-size:.72rem;background:#091520;padding:6px 8px;border-radius:5px;margin-top:3px;white-space:pre-wrap;word-break:break-word;color:#d7e3ee;}' +
    '.wx-dec{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:4px 12px;margin:6px 0 2px;font-size:.78rem;} .wx-dec div span{display:block;font-size:.58rem;text-transform:uppercase;letter-spacing:.05em;color:#9A9A9A;}' +
    'table.wx-lim{width:100%;border-collapse:collapse;font-size:.82rem;margin:4px 0 8px;} table.wx-lim th{text-align:left;font-size:.6rem;letter-spacing:.06em;text-transform:uppercase;color:#9A9A9A;padding:5px 6px;}' +
    'table.wx-lim td{padding:7px 6px;border-top:1px solid rgba(255,255,255,.08);vertical-align:top;} table.wx-lim tr.no td{background:rgba(229,72,77,.08);} table.wx-lim tr.warn td{background:rgba(245,165,36,.06);}' +
    '.wx-rate{display:inline-block;padding:3px 9px;border-radius:4px;font-weight:700;font-size:.68rem;letter-spacing:.06em;} .wx-rate.ok{background:#30A46C;color:#fff;} .wx-rate.warn{background:#F5A524;color:#091520;} .wx-rate.no{background:#E5484D;color:#fff;}' +
    '@media (max-width:560px){table.wx-lim td:first-child .wx-mute{display:none;}}' +
    'a.wx-jump{color:inherit;text-decoration:none;border-bottom:1px dotted rgba(0,162,233,.7);cursor:pointer;} a.wx-jump:hover{color:#00A2E9;} a.wx-jump span{color:#00A2E9;}' +
    '.wx-plain{font-size:.84rem;line-height:1.55;margin:6px 0;color:#eef4f9;} .wx-plain div{margin-bottom:3px;}' +
    '.wx-det summary{cursor:pointer;font-size:.74rem;color:#00A2E9;margin-top:4px;}' +
    '.wx-mute{color:#9A9A9A;font-size:.92em;} .wx-warn{color:#F5A524;font-size:.72rem;margin-top:2px;}' +
    '.wx-taf{margin-bottom:12px;font-size:.78rem;} .wx-taf code{display:block;font-size:.7rem;background:#091520;padding:6px 8px;border-radius:5px;margin-top:6px;white-space:pre-wrap;word-break:break-word;color:#d7e3ee;}' +
    'table.wx-taf-t{min-width:620px;margin-top:6px;} table.wx-taf-t td{white-space:normal;vertical-align:top;text-align:left;} table.wx-taf-t th{text-align:left;}' +
    'table.wx-taf-t tr.cur td{background:rgba(0,162,233,.12);} table.wx-taf-t tr.cur td:first-child{box-shadow:inset 3px 0 0 #00A2E9;} table.wx-taf-t tr.tmp td{background:rgba(255,255,255,.03);font-style:italic;}' +
    '.wx-fc{display:inline-block;padding:1px 6px;border-radius:4px;font-weight:700;font-size:.66rem;margin-left:6px;color:#091520;}' +
    '.wx-fc.VFR{background:#30A46C;} .wx-fc.MVFR{background:#3b82f6;color:#fff;} .wx-fc.IFR{background:#E5484D;color:#fff;} .wx-fc.LIFR{background:#B03C9A;color:#fff;}' +
    '.wx-sun{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:.78rem;} .wx-sun div span{display:block;font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:#9A9A9A;}' +
    '.wx-src{font-size:.66rem;color:#9A9A9A;line-height:1.45;margin-top:6px;} .wx-empty{font-size:.84rem;color:#9A9A9A;}' +
    '.wx-items{display:flex;flex-direction:column;gap:2px;} .wx-item{display:grid;grid-template-columns:14px 150px 1fr;gap:8px;align-items:start;padding:7px 0;border-top:1px solid rgba(255,255,255,.06);font-size:.84rem;}' +
    '.wx-item .dot{width:11px;height:11px;border-radius:50%;margin-top:4px;background:#9A9A9A;} .wx-item.ok .dot{background:#30A46C;} .wx-item.warn .dot{background:#F5A524;} .wx-item.no .dot{background:#E5484D;}' +
    '.wx-item .lbl{font-weight:700;} .wx-item.no .val{color:#ff9d8a;font-weight:700;} .wx-item .det{font-size:.7rem;color:#9A9A9A;font-weight:400;margin-top:2px;}' +
    '@media (max-width:560px){table.wx-taf-t{min-width:0;} table.wx-taf-t thead{display:none;} table.wx-taf-t tr{display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;padding:8px 6px;border-top:1px solid rgba(255,255,255,.08);}' +
    'table.wx-taf-t td{border:0;padding:0;background:none!important;box-shadow:none!important;} table.wx-taf-t td:first-child{grid-column:1 / -1;font-weight:700;}' +
    'table.wx-taf-t td[data-l]::before{content:attr(data-l);display:block;font-size:.58rem;text-transform:uppercase;letter-spacing:.05em;color:#9A9A9A;font-style:normal;font-weight:400;} table.wx-taf-t td[data-empty]{display:none;}' +
    'table.wx-taf-t tr.cur{background:rgba(0,162,233,.12);box-shadow:inset 3px 0 0 #00A2E9;} table.wx-taf-t tr.tmp{background:rgba(255,255,255,.03);}}' +
    '@media (max-width:560px){.wx-item{grid-template-columns:14px 1fr;} .wx-item .val{grid-column:2;} .wx-tiles{grid-template-columns:repeat(2,1fr);}}';
  function injectCss() { if (document.getElementById('ep-wx-css')) return; var st = document.createElement('style'); st.id = 'ep-wx-css'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectCss); else injectCss(); }

  window.EPWX = { fetchAll: fetchAll, evaluate: evaluate, nowIndex: nowIndex, windAtAlt: windAtAlt, metarInfo: metarInfo, sunEvent: sunEvent, sunToday: sunToday,
    tilesHTML: tilesHTML, hoursHTML: hoursHTML, alertsHTML: alertsHTML, metarsHTML: metarsHTML, tafsHTML: tafsHTML, limitsCheck: limitsCheck, limitsHTML: limitsHTML, avwxSnapshot: avwxSnapshot, avwxSnapshotHTML: avwxSnapshotHTML, tafOutlook: tafOutlook, wxText: wxText, sunHTML: sunHTML, itemsHTML: itemsHTML, WMO: WMO, compass: compass, fmtLocal: fmtLocal };
})();
