/* Enhanced Patrol: FAA airspace lookup for a single point.
   Data comes from the FAA's own public open data services (Aeronautical Information Services
   and the UAS Data Delivery System, hosted on ArcGIS Online) plus USGS ground elevation.
   No API key, no vendor. The lookup informs the assessment; the RPIC confirms every value.

   What it answers:  UASFM grid ceiling, controlled airspace at the surface, special use airspace,
   national security UAS flight restrictions, prohibited areas, national defense airspace,
   stadiums within 3 NM, and airports/heliports within 3 statute miles (Facility Notification
   Within 3 Miles (SP 19(d))).
   What it does not answer:  TFRs and NOTAMs. Those still need a manual check before each flight. */
(function () {
  'use strict';
  var BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
  var EPQS = 'https://epqs.nationalmap.gov/v1/json';
  var OPEN_METEO = 'https://api.open-meteo.com/v1/elevation';
  var TIMEOUT_MS = 12000;
  var ELEV_TIMEOUT_MS = 6000;
  var PIN_TOL_DEG = 0.0003;           // about 33 m: a pin this close to a boundary counts as inside
  var FAC_RADIUS_MI = 3;              // SP 19(d) states 3 miles, not nautical miles
  var LOWLEVEL_RADIUS_MI = 1;         // EP practice: low-level operations within 1 SM
  var STADIUM_RADIUS_NM = 3;
  var MI_PER_NM = 1.15078;
  var OPS_CEILING_AGL = 400;

  var LAYERS = {
    uasfm: { svc: 'FAA_UAS_FacilityMap_Data', label: 'UAS Facility Map', critical: true,
      fields: 'CEILING,UNIT,MAP_EFF,LAST_EDIT,ARPT_COUNT,APT1_FAAID,APT1_NAME,APT2_FAAID,APT2_NAME,APT3_FAAID,APT3_NAME,APT4_FAAID,APT4_NAME,APT5_FAAID,APT5_NAME,AIRSPACE_1,AIRSPACE_2,AIRSPACE_3,AIRSPACE_4,AIRSPACE_5' },
    cls: { svc: 'Class_Airspace', label: 'Class airspace', critical: true,
      fields: 'NAME,IDENT,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_UOM,LOWER_CODE,UPPER_VAL,UPPER_CODE,WKHR_CODE,WKHR_RMK' },
    sua: { svc: 'Special_Use_Airspace', label: 'Special use airspace', critical: true,
      fields: 'NAME,TYPE_CODE,LOWER_VAL,LOWER_CODE,UPPER_VAL,UPPER_CODE,TIMESOFUSE,CONT_AGENT' },
    pro: { svc: 'Prohibited_Areas', label: 'Prohibited areas', critical: true,
      fields: 'NAME,TYPE_CODE,LOWER_VAL,LOWER_CODE,UPPER_VAL,UPPER_CODE,TIMESOFUSE' },
    nsufr: { svc: 'DoD_Mar_13', label: 'National Security UAS Flight Restrictions', critical: true,
      fields: 'Facility,Base,Floor,Ceiling,Reason,State' },
    nsufrPt: { svc: 'Part_Time_National_Security_UAS_Flight_Restrictions', label: 'Part-time National Security UAS Flight Restrictions', critical: true,
      fields: 'Facility,Base,Floor,Ceiling,Reason,ACTIVETIME,ENDTIME' },
    nda: { svc: 'National_Defense_Airspace_TFR_Areas', label: 'National defense airspace', critical: true,
      fields: 'NAME,TYPE_CODE,LOCAL_TYPE,WKHR_CODE,WKHR_RMK' },
    apt: { svc: 'US_Airport', label: 'Airports and heliports', points: true,
      fields: 'IDENT,NAME,TYPE_CODE,PRIVATEUSE,MIL_CODE,OPERSTATUS,ELEVATION' },
    stad: { svc: 'Stadiums', label: 'Stadiums', points: true,
      fields: 'NAME,CITY,STATE,STATUS_CODE' }
  };

  var FAC_TYPES = { AD: 'Airport', HP: 'Heliport', SP: 'Seaplane base', UL: 'Ultralight park', GL: 'Gliderport', BP: 'Balloonport' };
  var SUA_TYPES = { R: 'Restricted area', P: 'Prohibited area', W: 'Warning area', A: 'Alert area', MOA: 'MOA', D: 'Danger area', NSA: 'National security area' };
  var CLASS_RANK = { B: 4, C: 3, D: 2, E: 1 };
  var CLASS_OPTION = { B: 'Class B', C: 'Class C', D: 'Class D', E: 'Class E surface' };

  function s(v) { return v === null || v === undefined ? '' : String(v).trim(); }
  function envelope(lat, lng, dLat) {
    var dLng = dLat / Math.max(0.2, Math.cos(lat * Math.PI / 180));
    return [lng - dLng, lat - dLat, lng + dLng, lat + dLat].map(function (x) { return x.toFixed(6); }).join(',');
  }
  function distMi(lat1, lng1, lat2, lng2) {
    var R = 3958.7613, r = Math.PI / 180;
    var dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  function withTimeout(url, ms) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, ms || TIMEOUT_MS);
    return fetch(url, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  }
  function query(key, lat, lng, dLat) {
    var L = LAYERS[key];
    var p = [
      'where=1%3D1',
      'geometry=' + encodeURIComponent(envelope(lat, lng, dLat)),
      'geometryType=esriGeometryEnvelope',
      'inSR=4326',
      'spatialRel=esriSpatialRelIntersects',
      'outFields=' + encodeURIComponent(L.fields),
      'returnGeometry=' + (L.points ? 'true&outSR=4326' : 'false'),
      'resultRecordCount=200',
      'f=json'
    ].join('&');
    var url = BASE + L.svc + '/FeatureServer/0/query?' + p;
    // ArcGIS Online throttles bursts (HTTP 200 with error code 429 in the body). Retry twice with backoff.
    var attempt = function (n) {
      return withTimeout(url).then(function (j) {
        if (j && j.error) throw new Error((j.error.code === 429 ? 'rate limited: ' : '') + (j.error.message || 'query error'));
        if (!j || !Array.isArray(j.features)) throw new Error('unexpected response');
        return j.features;
      }).catch(function (e) {
        if (n >= 2) throw e;
        return new Promise(function (res) { setTimeout(res, n === 0 ? 1500 : 4000); }).then(function () { return attempt(n + 1); });
      });
    };
    return attempt(0);
  }
  /* Ground elevation in ft MSL. Two free sources raced; the first valid answer wins. USGS EPQS is the
     authoritative US source but often takes 20 s or more; Open-Meteo (Copernicus 90 m DEM) usually
     answers in under a second and is close enough to convert airspace floors from MSL to AGL. */
  function elevation(lat, lng) {
    var ok = function (v) { return isFinite(v) && v > -1000 && v < 30000; };
    var usgs = withTimeout(EPQS + '?x=' + lng.toFixed(6) + '&y=' + lat.toFixed(6) + '&units=Feet&wkid=4326&includeDate=false', ELEV_TIMEOUT_MS)
      .then(function (j) { var v = j && Number(j.value); if (!ok(v)) throw new Error('no value'); return { ft: Math.round(v), src: 'USGS 3DEP' }; });
    var om = withTimeout(OPEN_METEO + '?latitude=' + lat.toFixed(6) + '&longitude=' + lng.toFixed(6), ELEV_TIMEOUT_MS)
      .then(function (j) { var m = j && j.elevation && Number(j.elevation[0]); if (!ok(m)) throw new Error('no value'); return { ft: Math.round(m * 3.28084), src: 'Copernicus DEM via Open-Meteo' }; });
    return new Promise(function (resolve) {
      var left = 2, done = false;
      var win = function (r) { if (!done) { done = true; resolve(r); } };
      var lose = function () { if (--left === 0) win(null); };
      usgs.then(win, lose); om.then(win, lose);
    });
  }

  /* Floor of an airspace volume in ft AGL, or null when it cannot be resolved. */
  function floorAgl(val, code, elev) {
    var c = s(code).toUpperCase(), raw = s(val).toUpperCase();
    if (raw === 'SFC' || raw === 'GND') return 0;
    var v = Number(val);
    if (!isFinite(v)) return null;
    if (v <= 0) return 0;
    if (c === 'SFC' || c === 'AGL') return v;
    if (c === 'STD') v = v * 100;                      // flight level
    if (c === 'MSL' || c === 'STD') {
      if (elev !== null) return v - elev;
      return v > 15000 ? v : null;                     // above any US terrain plus 400 ft: clearly out of the band
    }
    return null;
  }
  function altText(val, code) {
    var raw = s(val).toUpperCase(), c = s(code).toUpperCase();
    if (raw === 'SFC' || raw === 'GND') return 'surface';
    var v = Number(val);
    if (!isFinite(v)) return raw || 'unknown';
    if (v <= -9000) return 'unlimited';
    if (v <= 0) return 'surface';
    if (c === 'STD') return 'FL' + v;
    return v.toLocaleString('en-US') + ' ft ' + (c === 'SFC' ? 'AGL' : (c || 'MSL'));
  }
  function relevant(fl) { return fl === null || fl <= OPS_CEILING_AGL; }

  function analyze(lat, lng, raw, elevR, errors) {
    // Nearest airport or heliport within 3 miles is the last-resort elevation source.
    var elev = elevR ? elevR.ft : null, elevSrc = elevR ? elevR.src : '';
    if (elev === null) {
      var nearest = null;
      (raw.apt || []).forEach(function (f) {
        var g = f.geometry, e = f.attributes && Number(f.attributes.ELEVATION);
        if (!g || !isFinite(e)) return;
        var d = distMi(lat, lng, g.y, g.x);
        if (d <= FAC_RADIUS_MI && (!nearest || d < nearest.d)) nearest = { d: d, e: e, id: s(f.attributes.IDENT) };
      });
      if (nearest) { elev = Math.round(nearest.e); elevSrc = 'field elevation of ' + nearest.id + ', ' + nearest.d.toFixed(1) + ' mi away'; }
    }
    var R = {
      v: 1, lat: +lat.toFixed(6), lng: +lng.toFixed(6), at: new Date().toISOString(),
      elevFt: elev, elevSrc: elevSrc, grid: null, classes: [], controlled: false, classOption: '',
      sua: [], prohibited: [], nsufr: [], nsufrPartTime: [], nda: [], stadiums: [], facilities: [],
      errors: errors, flags: [], status: 'ok'
    };
    var flag = function (level, text) { R.flags.push({ level: level, text: text }); };

    // UASFM grid. A pin on a cell boundary can touch two cells: the lower ceiling governs.
    var cells = (raw.uasfm || []).map(function (f) { return f.attributes || {}; });
    if (cells.length) {
      var low = cells.reduce(function (a, b) { return Number(b.CEILING) < Number(a.CEILING) ? b : a; });
      var apts = [], asp = [];
      cells.forEach(function (c) {
        for (var i = 1; i <= 5; i++) {
          var id = s(c['APT' + i + '_FAAID']);
          if (id && !apts.some(function (a) { return a.id === id; })) apts.push({ id: id, name: s(c['APT' + i + '_NAME']) });
          var sp = s(c['AIRSPACE_' + i]).toUpperCase();
          if (sp && asp.indexOf(sp) < 0) asp.push(sp);
        }
      });
      R.grid = { ceiling: Number(low.CEILING), cells: cells.length, airports: apts, airspace: asp, mapEff: s(low.MAP_EFF), lastEdit: s(low.LAST_EDIT) };
      var ceilings = cells.map(function (c) { return Number(c.CEILING); });
      if (Math.max.apply(null, ceilings) !== Math.min.apply(null, ceilings))
        flag('info', 'The pin sits on a UASFM grid boundary (' + ceilings.join(' / ') + ' ft). The lower ceiling is used.');
    }

    // Class airspace that reaches down into the operating band (surface to 400 ft AGL).
    var best = 0, unknownFloor = false;
    (raw.cls || []).forEach(function (f) {
      var a = f.attributes || {}, cl = s(a.CLASS).toUpperCase();
      if (!CLASS_RANK[cl]) return;
      var fl = floorAgl(a.LOWER_VAL, a.LOWER_CODE, elev);
      if (!relevant(fl)) return;
      if (fl === null) unknownFloor = true;
      var hours = s(a.WKHR_CODE).toUpperCase();
      R.classes.push({
        name: s(a.NAME), cls: cl, type: s(a.LOCAL_TYPE),
        floor: altText(a.LOWER_VAL, a.LOWER_CODE), ceiling: altText(a.UPPER_VAL, a.UPPER_CODE),
        floorAgl: fl, partTime: !!hours && hours !== 'H24', hours: s(a.WKHR_RMK) || hours
      });
      if (fl !== null && CLASS_RANK[cl] > best) best = CLASS_RANK[cl];
    });
    // The UASFM cell names the controlled class too. Use whichever source is more restrictive.
    if (R.grid) R.grid.airspace.forEach(function (c) { if (CLASS_RANK[c] && CLASS_RANK[c] > best) best = CLASS_RANK[c]; });
    if (R.grid) R.grid.airspace.forEach(function (c) {
      if (CLASS_RANK[c] && !R.classes.some(function (x) { return x.cls === c && x.floorAgl === 0; }))
        flag('info', 'The UASFM cell lists Class ' + c + ' here, but the class airspace data shows no Class ' + c + ' surface area at the pin. The published grid is treated as governing.');
    });
    var bestClass = Object.keys(CLASS_RANK).filter(function (k) { return CLASS_RANK[k] === best; })[0];
    R.controlled = best > 0;
    R.classOption = R.controlled ? CLASS_OPTION[bestClass] : 'Class G';
    R.classes.sort(function (a, b) { return CLASS_RANK[b.cls] - CLASS_RANK[a.cls]; });

    // Special use airspace, prohibited areas.
    (raw.sua || []).forEach(function (f) {
      var a = f.attributes || {}, fl = floorAgl(a.LOWER_VAL, a.LOWER_CODE, elev);
      if (!relevant(fl)) return;
      R.sua.push({ name: s(a.NAME), type: SUA_TYPES[s(a.TYPE_CODE).toUpperCase()] || s(a.TYPE_CODE), floor: altText(a.LOWER_VAL, a.LOWER_CODE),
        ceiling: altText(a.UPPER_VAL, a.UPPER_CODE), times: s(a.TIMESOFUSE), agency: s(a.CONT_AGENT) });
    });
    (raw.pro || []).forEach(function (f) {
      var a = f.attributes || {};
      R.prohibited.push({ name: s(a.NAME), floor: altText(a.LOWER_VAL, a.LOWER_CODE), ceiling: altText(a.UPPER_VAL, a.UPPER_CODE) });
    });
    (raw.nsufr || []).forEach(function (f) {
      var a = f.attributes || {};
      R.nsufr.push({ facility: s(a.Facility) || s(a.Base), floor: s(a.Floor), ceiling: s(a.Ceiling), reason: s(a.Reason) });
    });
    (raw.nsufrPt || []).forEach(function (f) {
      var a = f.attributes || {};
      R.nsufrPartTime.push({ facility: s(a.Facility) || s(a.Base), floor: s(a.Floor), ceiling: s(a.Ceiling),
        active: a.ACTIVETIME ? new Date(a.ACTIVETIME).toISOString() : '', end: a.ENDTIME ? new Date(a.ENDTIME).toISOString() : '' });
    });
    (raw.nda || []).forEach(function (f) {
      var a = f.attributes || {};
      R.nda.push({ name: s(a.NAME), type: s(a.LOCAL_TYPE) || s(a.TYPE_CODE), hours: s(a.WKHR_RMK) || s(a.WKHR_CODE) });
    });

    // Point layers: distance from the pin.
    (raw.stad || []).forEach(function (f) {
      var a = f.attributes || {}, g = f.geometry;
      if (!g || !isFinite(g.x) || !isFinite(g.y)) return;
      var nm = distMi(lat, lng, g.y, g.x) / MI_PER_NM;
      if (nm <= STADIUM_RADIUS_NM) R.stadiums.push({ name: s(a.NAME), city: s(a.CITY), status: s(a.STATUS_CODE), nm: Math.round(nm * 100) / 100 });
    });
    (raw.apt || []).forEach(function (f) {
      var a = f.attributes || {}, g = f.geometry;
      if (!g || !isFinite(g.x) || !isFinite(g.y)) return;
      var mi = distMi(lat, lng, g.y, g.x);
      if (mi > FAC_RADIUS_MI) return;
      var mil = s(a.MIL_CODE).toUpperCase();
      R.facilities.push({ id: s(a.IDENT), name: s(a.NAME), type: FAC_TYPES[s(a.TYPE_CODE).toUpperCase()] || s(a.TYPE_CODE),
        priv: Number(a.PRIVATEUSE) === 1, mil: !!mil && mil !== 'CIVIL', status: s(a.OPERSTATUS), mi: Math.round(mi * 100) / 100 });
    });
    R.stadiums.sort(function (a, b) { return a.nm - b.nm; });
    R.facilities.sort(function (a, b) { return a.mi - b.mi; });

    // ---- Findings ----
    R.nsufr.forEach(function (x) {
      flag('stop', 'Inside a National Security UAS Flight Restriction: ' + x.facility + ' (' + (x.floor || 'surface') + ' to ' + (x.ceiling || '400 ft AGL') + '). No UAS operations. 14 CFR 99.7.');
    });
    R.prohibited.forEach(function (x) { flag('stop', 'Inside prohibited area ' + x.name + ' (' + x.floor + ' to ' + x.ceiling + '). 14 CFR 73.83.'); });
    R.nda.forEach(function (x) { flag('stop', 'Inside national defense airspace: ' + x.name + (x.hours ? ' (' + x.hours + ')' : '') + '. Confirm the restriction with the FAA before any operation.'); });
    R.nsufrPartTime.forEach(function (x) {
      flag('warn', 'Inside a part-time National Security UAS Flight Restriction: ' + x.facility + '. Operations are prohibited while it is active. Confirm activation before each flight.');
    });
    if (R.grid && R.grid.ceiling === 0)
      flag('warn', 'The published UASFM grid here is 0 ft. UASFM Grid Operations / NOTAM Requirement (SP 16) authorizes no altitude at this site. Flight needs a separate ATC authorization.');
    else if (R.controlled && !R.grid)
      flag('warn', 'Controlled airspace reaches the surface here but no UASFM grid is published. UASFM Grid Operations / NOTAM Requirement (SP 16) cannot authorize this site. Flight needs a separate ATC authorization.');
    else if (R.grid)
      flag('info', R.classOption + ' at the surface. UASFM Grid Operations / NOTAM Requirement (SP 16) authorizes operations at or below ' + R.grid.ceiling + ' ft AGL with a NOTAM filed 24 to 72 hours prior. LAANC may not be used for waivered operations.');
    else
      flag('info', 'No controlled airspace between the surface and 400 ft AGL at this pin. Class G: no airspace authorization required.');
    R.classes.filter(function (c) { return c.partTime; }).forEach(function (c) {
      flag('info', c.name + ' is part-time (' + (c.hours || 'see Chart Supplement') + '). Treat it as active unless the Chart Supplement shows it closed for the planned operating period.');
    });
    if (unknownFloor) flag('warn', 'Ground elevation was unavailable, so an airspace floor published in MSL could not be converted to AGL. That volume is treated as reaching the operating altitude. Confirm on the sectional.');
    R.sua.forEach(function (x) {
      flag('warn', 'Inside ' + x.type + ' ' + x.name + ' (' + x.floor + ' to ' + x.ceiling + (x.times ? ', ' + x.times : '') + '). Clear it with ' + (x.agency || 'the controlling agency') + ' or keep the site not approved.');
    });
    R.stadiums.forEach(function (x) {
      flag('warn', x.name + (x.city ? ', ' + x.city : '') + (x.nm < 0.1 ? ' is at the pin.' : ' is ' + x.nm.toFixed(1) + ' NM away.') + ' The stadium TFR (3 NM, up to 3,000 ft AGL) applies from 1 hour before to 1 hour after qualifying events.');
    });
    var near = R.facilities.filter(function (x) { return x.mi <= LOWLEVEL_RADIUS_MI; });
    flag('info', R.facilities.length
      ? R.facilities.length + ' airport or heliport record(s) within 3 miles (Facility Notification Within 3 Miles (SP 19(d)))' + (near.length ? ', ' + near.length + ' within 1 SM' : '') + '. Agricultural aerial application operations are not in this data.'
      : 'No airport or heliport record within 3 miles. Agricultural aerial application operations are not in this data.');
    errors.forEach(function (e) { flag('warn', 'The ' + (LAYERS[e] ? LAYERS[e].label : e) + ' query did not respond, so that check was not made. Re-run the lookup.'); });

    var levels = R.flags.map(function (f) { return f.level; });
    var critFail = errors.some(function (e) { return LAYERS[e] && LAYERS[e].critical; });
    R.status = levels.indexOf('stop') >= 0 ? 'stop' : critFail ? 'partial' : levels.indexOf('warn') >= 0 ? 'warn' : 'ok';
    return R;
  }

  var CACHE = {};
  function lookup(lat, lng) {
    lat = Number(lat); lng = Number(lng);
    var ck = lat.toFixed(5) + ',' + lng.toFixed(5);
    var hit = CACHE[ck];
    if (hit && Date.now() - hit.t < 10 * 60 * 1000) return Promise.resolve(JSON.parse(hit.r));
    if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return Promise.reject(new Error('Invalid coordinates'));
    var raw = {}, errors = [], elev = null;
    var facDeg = (FAC_RADIUS_MI + 0.05) / 69.05, stadDeg = (STADIUM_RADIUS_NM * MI_PER_NM + 0.05) / 69.05;
    var jobs = Object.keys(LAYERS).map(function (k) {
      var d = k === 'apt' ? facDeg : k === 'stad' ? stadDeg : PIN_TOL_DEG;
      return query(k, lat, lng, d).then(function (f) { raw[k] = f; }, function () { errors.push(k); raw[k] = []; });
    });
    jobs.push(elevation(lat, lng).then(function (v) { elev = v; }, function () { elev = null; }));
    return Promise.all(jobs).then(function () {
      if (errors.length === Object.keys(LAYERS).length) throw new Error('FAA data services unreachable');
      var R = analyze(lat, lng, raw, elev, errors);
      if (!errors.length) CACHE[ck] = { t: Date.now(), r: JSON.stringify(R) };
      return R;
    });
  }

  /* ---- Presentation ---- */
  function esc(v) { return s(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  var STATUS_TEXT = { ok: 'No airspace conflict found', warn: 'Review the flagged items', stop: 'Restricted: do not operate', partial: 'Incomplete: an FAA query did not respond' };
  function fmtTime(iso) {
    try { return new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
    catch (e) { return iso; }
  }
  function summaryLine(R) {
    if (!R) return '';
    return R.classOption + (R.grid ? ', UASFM grid ' + R.grid.ceiling + ' ft' : R.controlled ? ', no UASFM grid' : '') +
      (R.status === 'stop' ? ', restricted' : R.status === 'warn' ? ', review flags' : R.status === 'partial' ? ', incomplete' : '');
  }
  function renderHTML(R) {
    if (!R) return '';
    var row = function (k, v) { return '<div class="faa-kv"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>'; };
    var h = '<div class="faa-status faa-' + R.status + '"><span class="dot"></span>' + esc(STATUS_TEXT[R.status] || R.status) + '</div>';
    h += '<div class="faa-grid">';
    h += row('Airspace class', esc(R.classOption));
    h += row('UASFM grid height', R.grid ? esc(R.grid.ceiling + ' ft AGL') : (R.controlled ? 'None published' : 'Not applicable (Class G)'));
    if (R.grid && R.grid.airports.length) h += row('Grid airport', esc(R.grid.airports.map(function (a) { return a.id + (a.name ? ' ' + a.name : ''); }).join(', ')));
    h += row('Ground elevation', R.elevFt === null ? 'Unavailable' : esc(R.elevFt.toLocaleString('en-US') + ' ft MSL') + (R.elevSrc ? '<div class="faa-src">' + esc(R.elevSrc) + '</div>' : ''));
    h += '</div>';
    if (R.classes.length) {
      h += '<div class="faa-sub">Controlled airspace in the operating band</div><ul class="faa-list">' + R.classes.map(function (c) {
        return '<li>' + esc(c.name) + ': ' + esc(c.floor) + ' to ' + esc(c.ceiling) + (c.partTime ? ' (part-time)' : '') + '</li>';
      }).join('') + '</ul>';
    }
    h += '<ul class="faa-flags">' + R.flags.map(function (f) { return '<li class="faa-f-' + f.level + '">' + esc(f.text) + '</li>'; }).join('') + '</ul>';
    if (R.facilities.length) {
      h += '<details class="faa-fac"><summary>Airports and heliports within 3 miles (' + R.facilities.length + ')</summary><table><thead><tr><th>ID</th><th>Name</th><th>Type</th><th>Use</th><th>Distance</th></tr></thead><tbody>' +
        R.facilities.map(function (x) {
          return '<tr><td>' + esc(x.id) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.type) + '</td><td>' + (x.mil ? 'Military' : x.priv ? 'Private' : 'Public') +
            '</td><td>' + x.mi.toFixed(2) + ' mi</td></tr>';
        }).join('') + '</tbody></table></details>';
    }
    h += '<div class="faa-src">Source: FAA Aeronautical Information Services and UAS Data Delivery System open data' +
      (R.grid && R.grid.mapEff ? ', UASFM effective ' + esc(R.grid.mapEff) : '') + '; ground elevation ' + esc(R.elevSrc || 'unavailable') + '. Pulled ' + esc(fmtTime(R.at)) +
      ' for ' + R.lat.toFixed(5) + ', ' + R.lng.toFixed(5) + '. TFRs and NOTAMs are not covered. The RPIC confirms every value.</div>';
    return h;
  }
  function facilitiesText(R, maxMi) {
    if (!R) return '';
    return R.facilities.filter(function (x) { return x.mi <= maxMi; }).map(function (x) {
      return x.id + ' ' + x.name + ' (' + x.type.toLowerCase() + ', ' + x.mi.toFixed(1) + ' mi)';
    }).join('; ');
  }

  var CSS = '.faa-box{border:1px solid rgba(0,162,233,.35);border-radius:8px;padding:12px 14px;margin:6px 0 14px;background:rgba(0,162,233,.05);}' +
    '.faa-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:8px;}' +
    '.faa-head .t{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:var(--ep-blue,#00A2E9);font-weight:700;}' +
    '.faa-btns{display:flex;gap:6px;flex-wrap:wrap;}' +
    '.faa-btn{font:inherit;font-size:.72rem;padding:6px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.25);background:transparent;color:var(--ep-white,#fff);cursor:pointer;text-decoration:none;display:inline-block;}' +
    '.faa-btn.primary{background:var(--ep-dark-blue,#164998);border-color:var(--ep-blue,#00A2E9);}' +
    '.faa-btn:disabled{opacity:.5;cursor:default;}' +
    '.faa-status{display:flex;align-items:center;gap:8px;font-weight:700;font-size:.86rem;margin-bottom:8px;}' +
    '.faa-status .dot{width:10px;height:10px;border-radius:50%;background:var(--ep-gray,#9A9A9A);flex:0 0 auto;}' +
    '.faa-ok .dot{background:var(--ep-ok,#30A46C);} .faa-warn .dot,.faa-partial .dot{background:var(--ep-warn,#F5A524);} .faa-stop .dot{background:var(--ep-block,#E5484D);}' +
    '.faa-stop{color:#ff9d8a;}' +
    '.faa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 14px;margin-bottom:8px;}' +
    '.faa-kv .k{font-size:.64rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ep-gray,#9A9A9A);}' +
    '.faa-kv .v{font-size:.86rem;}' +
    '.faa-sub{font-size:.66rem;letter-spacing:.06em;text-transform:uppercase;color:var(--ep-gray,#9A9A9A);margin-top:4px;}' +
    '.faa-list,.faa-flags{margin:4px 0 8px 18px;padding:0;font-size:.8rem;line-height:1.45;}' +
    '.faa-flags li{margin-bottom:4px;} .faa-f-stop{color:#ff9d8a;font-weight:700;} .faa-f-warn{color:var(--ep-warn,#F5A524);} .faa-f-info{color:inherit;opacity:.9;}' +
    '.faa-fac{font-size:.78rem;margin:4px 0 8px;} .faa-fac summary{cursor:pointer;color:var(--ep-blue,#00A2E9);}' +
    '.faa-fac table{width:100%;border-collapse:collapse;margin-top:6px;} .faa-fac th,.faa-fac td{text-align:left;padding:3px 6px;border-bottom:1px solid rgba(255,255,255,.08);}' +
    '.faa-src{font-size:.68rem;color:var(--ep-gray,#9A9A9A);line-height:1.4;}' +
    '.faa-check{font-size:.8rem;margin-top:8px;padding:8px 10px;border-radius:6px;background:rgba(255,255,255,.04);}' +
    '.faa-check.bad{border-left:3px solid var(--ep-block,#E5484D);} .faa-check.good{border-left:3px solid var(--ep-ok,#30A46C);} .faa-check.note{border-left:3px solid var(--ep-warn,#F5A524);}' +
    '.faa-chip{font-size:.76rem;margin-top:8px;padding:6px 10px;border-radius:6px;background:rgba(0,162,233,.08);}' +
    '.faa-busy{font-size:.8rem;opacity:.8;}' +
    '@media print{.faa-btns{display:none!important;} .faa-fac{display:block;} .faa-fac[open] summary, .faa-fac summary{list-style:none;}}';
  function injectCss() {
    if (document.getElementById('ep-faa-css')) return;
    var st = document.createElement('style'); st.id = 'ep-faa-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', injectCss); else injectCss();
  }

  window.EPFAA = {
    version: '1.0',
    lookup: lookup, analyze: analyze, renderHTML: renderHTML, summaryLine: summaryLine,
    facilitiesText: facilitiesText, distMi: distMi, fmtTime: fmtTime,
    links: { tfr: 'https://tfr.faa.gov/', notam: 'https://notams.aim.faa.gov/notamSearch/' }
  };
})();
