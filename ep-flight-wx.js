/* Enhanced Patrol: flight-day weather for one point, shared by the Airspace & Weather page and the
   site assessment Go / No-Go panel.
   Sources: Open-Meteo forecast (wind at 10 m, 80 m and 120 m), National Weather Service active alerts,
   and aviationweather.gov METARs through the EP relay (/api/faa). Sun times are computed locally.
   The indicators only inform the RPIC. They never decide GO. */
(function () {
  'use strict';
  var WMO = { 0: 'Clear', 1: 'Mostly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle', 61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain', 71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers', 95: 'Thunderstorms', 96: 'Thunderstorms, hail', 99: 'Thunderstorms, hail' };
  var WET = [45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99];
  var METAR_NEAR_MI = 15;
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
    var fcUrl = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat.toFixed(4) + '&longitude=' + lng.toFixed(4) +
      '&current=temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m,visibility,cloud_cover_low,precipitation' +
      '&hourly=temperature_2m,dew_point_2m,precipitation_probability,precipitation,weather_code,cloud_cover_low,visibility,wind_speed_10m,wind_direction_10m,wind_gusts_10m,wind_speed_80m,wind_direction_80m,wind_speed_120m,wind_direction_120m' +
      '&wind_speed_unit=mph&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto&forecast_days=2';
    var d = 0.75, k = Math.cos(lat * Math.PI / 180);
    var bb = [lng - d / k, lat - d, lng + d / k, lat + d].map(function (n) { return n.toFixed(3); }).join(',');
    return Promise.all([
      // Through the relay only: one place to hold the commercial Open-Meteo key, and the edge
      // reaches Open-Meteo faster than some field networks. Direct is a last resort off the EP site.
      (RELAY ? timed(RELAY + '?src=forecast&lat=' + lat.toFixed(3) + '&lng=' + lng.toFixed(3), 20000) : timed(fcUrl, 25000))
        .then(function (j) { W.fc = j; }, function (e) { W.errors.fc = e.message || 'failed'; }),
      timed('https://api.weather.gov/alerts/active?point=' + lat.toFixed(4) + ',' + lng.toFixed(4), 12000, { headers: { Accept: 'application/geo+json' } })
        .then(function (j) { W.alerts = (j.features || []).map(function (f) { var p = f.properties || {}; return { event: p.event, severity: p.severity, headline: p.headline, ends: p.ends || p.expires }; }); },
          function (e) { W.errors.alerts = e.message || 'failed'; }),
      (RELAY ? timed(RELAY + '?src=metar&bbox=' + bb) : Promise.reject(new Error('relay unavailable')))
        .then(function (j) {
          W.metars = (j.metars || []).map(function (m) { m._mi = distMi(lat, lng, m.lat, m.lon); return m; }).sort(function (a, b) { return a._mi - b._mi; }).slice(0, 3);
        }, function (e) { W.errors.metar = e.message || 'failed'; })
    ]).then(function () { return W; });
  }

  function nowIndex(fc) {
    var H = fc && fc.hourly; if (!H || !H.time) return 0;
    var iso = new Date(Date.now() + (fc.utc_offset_seconds || 0) * 1000).toISOString().slice(0, 13);
    for (var i = 0; i < H.time.length; i++) if (H.time[i].slice(0, 13) >= iso) return i;
    return 0;
  }
  /* Model level at or above the planned altitude: 10 m is 33 ft, 80 m is 262 ft, 120 m is 394 ft. */
  function windAtAlt(fc, i, altFt) {
    var H = fc.hourly;
    if (altFt == null || altFt <= 33) return { spd: H.wind_speed_10m[i], dir: H.wind_direction_10m[i], level: '10 m' };
    if (altFt <= 262) return { spd: Math.max(H.wind_speed_10m[i], H.wind_speed_80m[i]), dir: H.wind_direction_80m[i], level: '80 m' };
    return { spd: Math.max(H.wind_speed_80m[i], H.wind_speed_120m[i]), dir: H.wind_direction_120m[i], level: '120 m' };
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

  /* ---- Go / No-Go indicators. level: ok | warn | no ---- */
  function evaluate(W, ctx) {
    ctx = ctx || {};
    var out = [], add = function (key, label, level, value, detail) { out.push({ key: key, label: label, level: level, value: value, detail: detail || '' }); };
    var fc = W.fc, i = fc ? nowIndex(fc) : 0, H = fc && fc.hourly;
    var alt = ctx.plannedAltFt != null ? ctx.plannedAltFt : null, lim = ctx.windLimit;
    var near = (W.metars || []).map(metarInfo).filter(function (m) { return m && m.mi <= METAR_NEAR_MI; })[0] || null;

    // Wind at operating altitude and gusts, now and the next two hours
    if (!fc) add('wind', 'Wind', 'warn', 'Unavailable', 'Forecast did not load. Check wind another way.');
    else {
      var w = windAtAlt(fc, i, alt), g = H.wind_gusts_10m[i], worst = Math.max(w.spd, g);
      var later = 0; for (var k = i + 1; k <= Math.min(i + 2, H.time.length - 1); k++) later = Math.max(later, windAtAlt(fc, k, alt).spd, H.wind_gusts_10m[k]);
      var val = Math.round(w.spd) + ' mph at ' + w.level + ' from ' + compass(w.dir) + ', gusts ' + Math.round(g);
      if (lim == null) add('wind', 'Wind', 'warn', val, 'No aircraft wind limit on record. Set it in the fleet record or here.');
      else if (worst >= lim) add('wind', 'Wind', 'no', val, 'At or above the ' + lim + ' mph aircraft limit.');
      else if (later >= lim) add('wind', 'Wind', 'warn', val, 'Forecast to reach ' + Math.round(later) + ' mph within 2 hours (limit ' + lim + ').');
      else if (worst >= 0.8 * lim) add('wind', 'Wind', 'warn', val, 'Within 20% of the ' + lim + ' mph limit.');
      else add('wind', 'Wind', 'ok', val, 'Below the ' + lim + ' mph limit.');
    }
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
    } else if (fc && fc.current && fc.current.cloud_cover_low >= 70) add('ceiling', 'Ceiling', 'warn', 'Low cloud ' + fc.current.cloud_cover_low + '% (forecast)', 'No METAR within ' + METAR_NEAR_MI + ' mi. Confirm 500 ft below clouds, 14 CFR 107.51(d)(1).');
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
    // Temperature against the aircraft limits
    if (fc && fc.current) {
      var T = fc.current.temperature_2m, lo = ctx.tempMin, hi = ctx.tempMax;
      if (lo == null && hi == null) add('temp', 'Temperature', 'warn', Math.round(T) + '°F', 'No aircraft temperature limits on record.');
      else {
        var bad = (lo != null && T < lo) || (hi != null && T > hi), close = (lo != null && T < lo + 5) || (hi != null && T > hi - 5);
        add('temp', 'Temperature', bad ? 'no' : close ? 'warn' : 'ok', Math.round(T) + '°F', 'Aircraft limits ' + (lo != null ? lo : '?') + ' to ' + (hi != null ? hi : '?') + '°F.');
      }
    }
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
      tile('Wind 80 m', Math.round(H.wind_speed_80m[i]) + ' mph', 'about 260 ft', lvl(H.wind_speed_80m[i])) +
      tile('Wind 120 m', Math.round(H.wind_speed_120m[i]) + ' mph', 'about 390 ft', lvl(H.wind_speed_120m[i])) +
      tile('Visibility', vis(c.visibility) + ' mi', 'low cloud ' + c.cloud_cover_low + '%', (c.visibility != null && c.visibility < 4828) ? ' warn' : '') +
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
    return '<div class="wx-scroll"><table class="wx-table"><thead><tr><th>Hour</th><th>Sky</th><th>Temp</th><th>Rain</th><th>Wind 10 m</th><th>Gust</th><th>80 m</th><th>120 m</th><th>Vis mi</th><th>Low cld</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="wx-src">Winds in mph; the arrow points where the wind is blowing. &#9790; marks hours outside civil twilight. Local time at the site.</div>';
  }
  function alertsHTML(W) {
    if (W.alerts === null) return '<div class="wx-empty">National Weather Service alerts unavailable (US locations only).</div>';
    if (!W.alerts.length) return '<div class="wx-empty">No active alerts for this point.</div>';
    return W.alerts.map(function (a) {
      return '<div class="wx-alert' + (/Extreme|Severe/.test(a.severity || '') ? ' sev' : '') + '"><b>' + esc(a.event) + '</b>' + (a.severity ? ' (' + esc(a.severity) + ')' : '') + '<div class="wx-src">' + esc(a.headline || '') + '</div></div>';
    }).join('');
  }
  function metarsHTML(W) {
    if (W.metars === null) return '<div class="wx-empty">METARs unavailable right now.</div>';
    if (!W.metars.length) return '<div class="wx-empty">No reporting station within about 50 miles.</div>';
    return W.metars.map(function (x) {
      var m = metarInfo(x);
      return '<div class="wx-metar"><b>' + esc(m.id) + '</b> ' + esc(m.name || '') + ' <span class="wx-src" style="display:inline">' + m.mi.toFixed(1) + ' mi' + (m.ageMin != null ? ', ' + m.ageMin + ' min old' : '') + '</span>' +
        (m.fltCat ? '<span class="wx-fc ' + esc(m.fltCat) + '">' + esc(m.fltCat) + '</span>' : '') + '<code>' + esc(m.raw) + '</code></div>';
    }).join('');
  }
  function sunHTML(W) {
    var s = sunToday(W);
    return '<div class="wx-sun"><div><span>Civil dawn</span>' + fmtLocal(s.cv && s.cv.rise, s.off) + '</div><div><span>Sunrise</span>' + fmtLocal(s.sr && s.sr.rise, s.off) +
      '</div><div><span>Sunset</span>' + fmtLocal(s.sr && s.sr.set, s.off) + '</div><div><span>Civil dusk</span>' + fmtLocal(s.cv && s.cv.set, s.off) + '</div></div>' +
      '<div class="wx-src">Today at the site, local time. Outside civil twilight, anti-collision lighting visible 3 SM is required (14 CFR 107.29).</div>';
  }
  function itemsHTML(items) {
    return '<div class="wx-items">' + items.map(function (x) {
      return '<div class="wx-item ' + x.level + '"><span class="dot"></span><div class="lbl">' + esc(x.label) + '</div><div class="val">' + esc(x.value) +
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
    '.wx-fc{display:inline-block;padding:1px 6px;border-radius:4px;font-weight:700;font-size:.66rem;margin-left:6px;color:#091520;}' +
    '.wx-fc.VFR{background:#30A46C;} .wx-fc.MVFR{background:#3b82f6;color:#fff;} .wx-fc.IFR{background:#E5484D;color:#fff;} .wx-fc.LIFR{background:#B03C9A;color:#fff;}' +
    '.wx-sun{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:.78rem;} .wx-sun div span{display:block;font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:#9A9A9A;}' +
    '.wx-src{font-size:.66rem;color:#9A9A9A;line-height:1.45;margin-top:6px;} .wx-empty{font-size:.84rem;color:#9A9A9A;}' +
    '.wx-items{display:flex;flex-direction:column;gap:2px;} .wx-item{display:grid;grid-template-columns:14px 150px 1fr;gap:8px;align-items:start;padding:7px 0;border-top:1px solid rgba(255,255,255,.06);font-size:.84rem;}' +
    '.wx-item .dot{width:11px;height:11px;border-radius:50%;margin-top:4px;background:#9A9A9A;} .wx-item.ok .dot{background:#30A46C;} .wx-item.warn .dot{background:#F5A524;} .wx-item.no .dot{background:#E5484D;}' +
    '.wx-item .lbl{font-weight:700;} .wx-item.no .val{color:#ff9d8a;font-weight:700;} .wx-item .det{font-size:.7rem;color:#9A9A9A;font-weight:400;margin-top:2px;}' +
    '@media (max-width:560px){.wx-item{grid-template-columns:14px 1fr;} .wx-item .val{grid-column:2;} .wx-tiles{grid-template-columns:repeat(2,1fr);}}';
  function injectCss() { if (document.getElementById('ep-wx-css')) return; var st = document.createElement('style'); st.id = 'ep-wx-css'; st.textContent = CSS; (document.head || document.documentElement).appendChild(st); }
  if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectCss); else injectCss(); }

  window.EPWX = { fetchAll: fetchAll, evaluate: evaluate, nowIndex: nowIndex, windAtAlt: windAtAlt, metarInfo: metarInfo, sunEvent: sunEvent, sunToday: sunToday,
    tilesHTML: tilesHTML, hoursHTML: hoursHTML, alertsHTML: alertsHTML, metarsHTML: metarsHTML, sunHTML: sunHTML, itemsHTML: itemsHTML, WMO: WMO, compass: compass, fmtLocal: fmtLocal };
})();
