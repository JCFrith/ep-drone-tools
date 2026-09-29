/* Enhanced Patrol: FAA airspace overlays for a Leaflet map.
   Draws UASFM grid cells (labelled with their ceiling), controlled airspace that reaches the surface,
   special use airspace, national security UAS flight restrictions, prohibited areas, national defense
   airspace, stadium 3 NM rings, airports and heliports, and TFRs (through the EP relay).
   Overlays are drawn only: they do not take clicks, so tapping the map still drops the pin, and the
   pin lookup (ep-faa-airspace.js) explains what applies at that spot.

   Usage:  var ctl = EPFAAMap.attach(leafletMap, { relay: '/api/faa' });   ctl.remove() to detach. */
(function () {
  'use strict';
  var BASE = 'https://services6.arcgis.com/ssFJjBXIUyZDrSYZ/arcgis/rest/services/';
  var NM_M = 1852;
  var SECTIONAL = 'https://tiles.arcgis.com/tiles/ssFJjBXIUyZDrSYZ/arcgis/rest/services/VFR_Sectional/MapServer/tile/{z}/{y}/{x}';

  var DEFS = [
    { key: 'uasfm', name: 'UASFM grid (ft AGL)', svc: 'FAA_UAS_FacilityMap_Data', minZoom: 12, on: true,
      fields: 'CEILING', simplify: false },
    { key: 'cls', name: 'Controlled airspace at the surface', svc: 'Class_Airspace', minZoom: 8, on: true,
      fields: 'NAME,CLASS,LOCAL_TYPE,LOWER_VAL,LOWER_CODE,UPPER_VAL',
      where: "CLASS IN ('B','C','D') OR LOCAL_TYPE IN ('CLASS_E2','CLASS_E3','CLASS_E4')" },
    { key: 'sua', name: 'Special use airspace', svc: 'Special_Use_Airspace', minZoom: 7, on: true,
      fields: 'NAME,TYPE_CODE,LOWER_VAL,UPPER_VAL' },
    { key: 'nsr', name: 'National security, prohibited, defense', minZoom: 7, on: true, multi: [
      { svc: 'DoD_Mar_13', fields: 'Facility' },
      { svc: 'Part_Time_National_Security_UAS_Flight_Restrictions', fields: 'Facility' },
      { svc: 'Prohibited_Areas', fields: 'NAME' },
      { svc: 'National_Defense_Airspace_TFR_Areas', fields: 'NAME' }
    ] },
    { key: 'stad', name: 'Stadium 3 NM rings', svc: 'Stadiums', minZoom: 8, on: true, fields: 'NAME', points: true },
    { key: 'tfr', name: 'TFRs', relay: true, minZoom: 6, on: true },
    { key: 'apt', name: 'Airports and heliports', svc: 'US_Airport', minZoom: 10, on: false,
      fields: 'IDENT,NAME,TYPE_CODE', points: true }
  ];

  function gridColor(c) {
    c = Number(c);
    if (c <= 0) return '#E5484D';
    if (c <= 100) return '#F76B15';
    if (c <= 200) return '#F5A524';
    if (c <= 300) return '#9ACD32';
    return '#30A46C';
  }
  function style(key, props) {
    var p = props || {};
    if (key === 'uasfm') { var c = gridColor(p.CEILING); return { color: c, weight: 0.6, fillColor: c, fillOpacity: 0.22, interactive: false }; }
    if (key === 'cls') {
      var cl = String(p.CLASS || '').toUpperCase();
      if (cl === 'B') return { color: '#1E6FD9', weight: 2.2, fillOpacity: 0.05, interactive: false };
      if (cl === 'C') return { color: '#B03C9A', weight: 2.2, fillOpacity: 0.05, interactive: false };
      if (cl === 'D') return { color: '#1E6FD9', weight: 1.8, dashArray: '6 5', fillOpacity: 0.04, interactive: false };
      return { color: '#B03C9A', weight: 1.6, dashArray: '4 6', fillOpacity: 0.03, interactive: false };
    }
    if (key === 'sua') {
      var t = String(p.TYPE_CODE || '').toUpperCase();
      if (t === 'R' || t === 'P') return { color: '#1E6FD9', weight: 1.6, dashArray: '2 4', fillColor: '#1E6FD9', fillOpacity: 0.07, interactive: false };
      return { color: '#B03C9A', weight: 1.4, dashArray: '8 4', fillColor: '#B03C9A', fillOpacity: 0.04, interactive: false };
    }
    if (key === 'nsr') return { color: '#E5484D', weight: 1.8, fillColor: '#E5484D', fillOpacity: 0.28, interactive: false };
    if (key === 'tfr') return { color: '#E5484D', weight: 2, dashArray: '6 4', fillColor: '#E5484D', fillOpacity: 0.12, interactive: false };
    return { interactive: false };
  }
  function degPerPx(z) { return 360 / (256 * Math.pow(2, z)); }
  function pad(b, f) {
    var dx = (b[2] - b[0]) * f, dy = (b[3] - b[1]) * f;
    return [Math.max(-180, b[0] - dx), Math.max(-85, b[1] - dy), Math.min(180, b[2] + dx), Math.min(85, b[3] + dy)];
  }
  function contains(o, i) { return o && i[0] >= o[0] && i[1] >= o[1] && i[2] <= o[2] && i[3] <= o[3]; }
  function fetchJson(url, tries) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) { if (j && j.error) throw new Error(j.error.message || 'error'); return j; })
      .catch(function (e) {
        if ((tries || 0) >= 1) throw e;
        return new Promise(function (res) { setTimeout(res, 1800); }).then(function () { return fetchJson(url, 1); });
      });
  }
  function arcUrl(svc, fields, where, bbox, z, points) {
    var p = [
      'where=' + encodeURIComponent(where || '1=1'),
      'geometry=' + encodeURIComponent(bbox.map(function (n) { return n.toFixed(5); }).join(',')),
      'geometryType=esriGeometryEnvelope', 'inSR=4326', 'spatialRel=esriSpatialRelIntersects',
      'outFields=' + encodeURIComponent(fields || ''), 'returnGeometry=true', 'outSR=4326',
      'geometryPrecision=5', 'resultRecordCount=2000', 'f=geojson'
    ];
    if (!points && z !== null) p.push('maxAllowableOffset=' + (degPerPx(z) * 0.8).toFixed(7));
    return BASE + svc + '/FeatureServer/0/query?' + p.join('&');
  }

  var CSS = '.epm-status{background:rgba(9,21,32,.88);color:#fff;font:12px/1.35 Montserrat,system-ui,sans-serif;padding:6px 9px;border-radius:6px;max-width:260px;}' +
    '.epm-status .warn{color:#F5A524;} .epm-legend{background:rgba(9,21,32,.88);color:#fff;font:11px/1.4 Montserrat,system-ui,sans-serif;padding:7px 9px;border-radius:6px;}' +
    '.epm-legend i{display:inline-block;width:12px;height:12px;margin-right:6px;vertical-align:-2px;border-radius:2px;}' +
    '.epm-legend .sw{display:flex;gap:3px;margin-top:3px;} .epm-legend .sw span{padding:0 4px;border-radius:2px;color:#091520;font-weight:700;}' +
    '.epm-legend summary{cursor:pointer;font-weight:700;} .epm-grid-lbl{font:700 10px Montserrat,system-ui,sans-serif;color:#091520;background:rgba(255,255,255,.75);border-radius:3px;padding:0 2px;text-align:center;white-space:nowrap;}' +
    '.leaflet-control-layers{font:12px Montserrat,system-ui,sans-serif;}';
  function injectCss() {
    if (document.getElementById('ep-faa-map-css')) return;
    var st = document.createElement('style'); st.id = 'ep-faa-map-css'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  function attach(map, opts) {
    if (!map || typeof L === 'undefined') return null;
    opts = opts || {};
    injectCss();
    var relay = opts.relay === undefined ? ((typeof location !== 'undefined' && /^https?:$/.test(location.protocol)) ? '/api/faa' : null) : opts.relay;
    if (!map.getPane('epAirspace')) { map.createPane('epAirspace'); map.getPane('epAirspace').style.zIndex = 390; map.getPane('epAirspace').style.pointerEvents = 'none'; }
    var state = {}, overlays = {}, timer = null, dead = false;
    DEFS.forEach(function (d) {
      if (d.relay && !relay) return;
      var g = L.layerGroup();
      state[d.key] = { def: d, group: g, box: null, z: null, busy: false, err: '' };
      overlays[d.name] = g;
      if (d.on && opts[d.key] !== false) g.addTo(map);
    });
    // FAA sectional chart as an alternate base map (public domain, native zoom 8 to 12).
    var bases = null;
    if (opts.base) {
      bases = { 'Street map': opts.base, 'FAA sectional chart': L.tileLayer(SECTIONAL, {
        minNativeZoom: 8, maxNativeZoom: 12, maxZoom: 19, attribution: 'Charts: FAA Aeronautical Information Services' }) };
    }
    var layerCtl = L.control.layers(bases, overlays, { collapsed: opts.collapsed !== false, position: opts.position || 'topright' }).addTo(map);

    var status = L.control({ position: 'bottomleft' });
    status.onAdd = function () { this._div = L.DomUtil.create('div', 'epm-status'); L.DomEvent.disableClickPropagation(this._div); return this._div; };
    status.addTo(map);
    var legend = null;
    if (opts.legend !== false) {
      legend = L.control({ position: 'bottomright' });
      legend.onAdd = function () {
        var d = L.DomUtil.create('div', 'epm-legend');
        d.innerHTML = '<details' + (opts.legendOpen ? ' open' : '') + '><summary>Airspace key</summary>' +
          '<div><i style="border:2px solid #1E6FD9"></i>Class B / D (dashed)</div>' +
          '<div><i style="border:2px solid #B03C9A"></i>Class C / E surface (dashed)</div>' +
          '<div><i style="background:rgba(229,72,77,.35);border:1px solid #E5484D"></i>No-fly: national security, prohibited</div>' +
          '<div><i style="background:rgba(229,72,77,.15);border:2px dashed #E5484D"></i>TFR</div>' +
          '<div><i style="border:2px dashed #1E6FD9"></i>Restricted area</div><div><i style="border:2px dashed #B03C9A"></i>MOA, alert, warning</div>' +
          '<div style="margin-top:3px">UASFM grid ceiling</div><div class="sw">' +
          [[0, '0'], [100, '100'], [200, '200'], [300, '300'], [400, '400']].map(function (x) { return '<span style="background:' + gridColor(x[0]) + '">' + x[1] + '</span>'; }).join('') +
          '</div></details>';
        L.DomEvent.disableClickPropagation(d);
        return d;
      };
      legend.addTo(map);
    }

    function setStatus() {
      if (!status._div) return;
      var z = map.getZoom(), msgs = [], busy = false;
      Object.keys(state).forEach(function (k) {
        var st = state[k];
        if (!map.hasLayer(st.group)) return;
        if (st.busy) busy = true;
        if (z < st.def.minZoom) msgs.push('Zoom in to show ' + st.def.name.toLowerCase());
        else if (st.err) msgs.push('<span class="warn">' + st.def.name + ' did not load</span>');
      });
      var hide = !busy && !msgs.length;
      status._div.style.display = hide ? 'none' : '';
      status._div.innerHTML = (busy ? 'Loading FAA airspace' + (msgs.length ? '<br>' : '') : '') + msgs.slice(0, 3).join('<br>');
    }

    function draw(st, geojson, z) {
      var d = st.def, g = st.group;
      g.clearLayers();
      var feats = (geojson && geojson.features) || [];
      if (d.key === 'stad') {
        feats.forEach(function (f) {
          var c = f.geometry && f.geometry.coordinates; if (!c) return;
          L.circle([c[1], c[0]], { radius: 3 * NM_M, pane: 'epAirspace', color: '#F5A524', weight: 1.5, dashArray: '3 5', fillColor: '#F5A524', fillOpacity: 0.06, interactive: false }).addTo(g);
        });
        return;
      }
      if (d.key === 'apt') {
        feats.forEach(function (f) {
          var c = f.geometry && f.geometry.coordinates; if (!c) return;
          var p = f.properties || {}, hp = String(p.TYPE_CODE).toUpperCase() === 'HP';
          L.circleMarker([c[1], c[0]], { pane: 'epAirspace', radius: hp ? 4 : 5, color: '#fff', weight: 1, fillColor: hp ? '#B03C9A' : '#1E6FD9', fillOpacity: 0.9, interactive: false }).addTo(g);
          if (z >= 12) L.marker([c[1], c[0]], { pane: 'epAirspace', interactive: false, keyboard: false,
            icon: L.divIcon({ className: '', html: '<div class="epm-grid-lbl" style="transform:translate(8px,-6px)">' + String(p.IDENT || '') + '</div>', iconSize: [0, 0] }) }).addTo(g);
        });
        return;
      }
      L.geoJSON(geojson, { pane: 'epAirspace', style: function (f) { return style(d.key, f.properties); }, interactive: false }).addTo(g);
      if (d.key === 'uasfm' && z >= 14) {
        feats.forEach(function (f) {
          var ring = f.geometry && f.geometry.coordinates && (f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]);
          if (!ring || !ring.length) return;
          var x = 0, y = 0; ring.forEach(function (pt) { x += pt[0]; y += pt[1]; }); x /= ring.length; y /= ring.length;
          L.marker([y, x], { pane: 'epAirspace', interactive: false, keyboard: false,
            icon: L.divIcon({ className: '', html: '<div class="epm-grid-lbl" style="transform:translate(-50%,-50%)">' + f.properties.CEILING + '</div>', iconSize: [0, 0] }) }).addTo(g);
        });
      }
    }

    function loadLayer(st, view, z) {
      var d = st.def;
      if (!map.hasLayer(st.group)) return;
      if (z < d.minZoom) { st.group.clearLayers(); st.box = null; st.err = ''; return; }
      var zoomStale = st.z === null || (!d.points && Math.abs(z - st.z) >= 2) || (d.key === 'uasfm' && (st.z < 14) !== (z < 14)) || (d.key === 'apt' && (st.z < 12) !== (z < 12));
      if (contains(st.box, view) && !zoomStale) return;
      var box = pad(view, d.key === 'uasfm' ? 0.35 : 0.6);
      var zq = Math.round(z);
      st.busy = true; st.err = ''; setStatus();
      var p;
      if (d.relay) {
        p = fetchJson(relay + '?src=tfr&bbox=' + box.map(function (n) { return n.toFixed(4); }).join(','));
      } else if (d.multi) {
        p = Promise.all(d.multi.map(function (m) { return fetchJson(arcUrl(m.svc, m.fields, null, box, zq, false)); }))
          .then(function (arr) { return { type: 'FeatureCollection', features: [].concat.apply([], arr.map(function (a) { return a.features || []; })) }; });
      } else {
        p = fetchJson(arcUrl(d.svc, d.fields, d.where, box, d.simplify === false ? null : zq, d.points));
      }
      p.then(function (gj) {
        if (dead) return;
        st.busy = false; st.box = box; st.z = zq;
        draw(st, gj, zq); setStatus();
      }, function (e) {
        if (dead) return;
        st.busy = false; st.err = e && e.message ? e.message : 'failed'; st.box = null; setStatus();
      });
    }

    function refresh() {
      if (dead) return;
      var b = map.getBounds(), view = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], z = map.getZoom();
      Object.keys(state).forEach(function (k) { loadLayer(state[k], view, z); });
      setStatus();
    }
    function queue() { clearTimeout(timer); timer = setTimeout(refresh, 450); }
    map.on('moveend', queue);
    map.on('overlayadd', queue);
    map.on('overlayremove', setStatus);
    setTimeout(refresh, 250);

    return {
      refresh: refresh,
      remove: function () {
        dead = true; clearTimeout(timer);
        map.off('moveend', queue); map.off('overlayadd', queue); map.off('overlayremove', setStatus);
        Object.keys(state).forEach(function (k) { map.removeLayer(state[k].group); });
        map.removeControl(layerCtl); map.removeControl(status); if (legend) map.removeControl(legend);
      }
    };
  }

  window.EPFAAMap = { attach: attach, gridColor: gridColor };
})();
