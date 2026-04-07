import L from 'leaflet';
import { getForecastArea, normalizePolygonForDateline } from './parser.js';

let map;
let layerGroup;
let boundaryLayer = null;

export function initMap() {
  map = L.map('map', { center: [50, -50], zoom: 4, minZoom: 2, maxZoom: 10 });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: 'OpenStreetMap & CARTO',
    subdomains: 'abcd',
    maxZoom: 20
  }).addTo(map);
  layerGroup = L.layerGroup().addTo(map);
  return map;
}

export function getMap() {
  return map;
}

export function getLayerGroup() {
  return layerGroup;
}

export function populateWarningDropdown(forecast) {
  var select = document.getElementById('warning-filter');
  select.innerHTML = '<option value="all">All Warning Blocks</option>';
  if (forecast.warningBlocks) {
    for (var i = 0; i < forecast.warningBlocks.length; i++) {
      var opt = document.createElement('option');
      opt.value = forecast.warningBlocks[i];
      opt.textContent = forecast.warningBlocks[i];
      select.appendChild(opt);
    }
  }
}

export function renderParsedOutput(forecast) {
  var output = document.getElementById('parsed-output');
  var html = '<div class="parsed-section"><h4>Low Pressure Centers (' + forecast.lowCenters.length + ')</h4>';
  for (var i = 0; i < forecast.lowCenters.length; i++) {
    var low = forecast.lowCenters[i];
    html += '<div class="parsed-item"><span class="label">Position:</span> <span class="value">' + low.position.lat + 'N ' + Math.abs(low.position.lon) + 'W</span><br><span class="label">Pressure:</span> <span class="value">' + low.pressure + ' mb</span>' + (low.movement ? '<br><span class="label">Moving:</span> <span class="value">' + low.movement.direction + ' ' + low.movement.speed + ' kt</span>' : '') + (low.forecast ? '<br><span class="label">Forecast:</span> <span class="value">' + low.forecast + '</span>' : '') + '</div>';
  }
  html += '</div><div class="parsed-section"><h4>Wind Areas (' + forecast.windAreas.length + ')</h4>';
  for (var i = 0; i < forecast.windAreas.length; i++) {
    var area = forecast.windAreas[i];
    html += '<div class="parsed-item"><span class="label">Type:</span> <span class="value">' + area.warningType + ' (' + area.type + ')</span><br><span class="label">Winds:</span> <span class="value">' + area.windSpeed.min + '-' + area.windSpeed.max + ' KT</span>' + (area.seas ? '<br><span class="label">Seas:</span> <span class="value">' + area.seas.min + '-' + area.seas.max + ' M</span>' : '') + (area.forecast ? '<br><span class="label">Forecast:</span> <span class="value">' + area.forecast + '</span>' : '') + '</div>';
  }
  html += '</div><div class="parsed-section"><h4>Freezing Spray (' + forecast.freezingSprayLines.length + ')</h4>';
  for (var i = 0; i < forecast.freezingSprayLines.length; i++) {
    var s = forecast.freezingSprayLines[i];
    html += '<div class="parsed-item"><span class="label">Severity:</span> <span class="value">' + s.severity + '</span><br><span class="label">Direction:</span> <span class="value">' + s.direction + ' of line</span></div>';
  }
  html += '</div><div class="parsed-section"><h4>Fog Areas (' + forecast.fogAreas.length + ')</h4>';
  for (var i = 0; i < forecast.fogAreas.length; i++) {
    html += '<div class="parsed-item"><span class="label">Bounds:</span> <span class="value">' + forecast.fogAreas[i].bounds.length + ' points</span></div>';
  }
  html += '</div>';
  output.innerHTML = html;
}

export function renderForecast(forecast, filter, warningFilter, layerVisibility, windAreaById) {
  filter = filter || 'all';
  warningFilter = warningFilter || 'all';
  windAreaById = windAreaById || null;

  layerGroup.clearLayers();
  if (boundaryLayer) {
    if (layerVisibility.boundary) boundaryLayer.addTo(map);
    else boundaryLayer.remove();
  }

  function matchesWarningFilter(item, wf) {
    return wf === 'all' || item.warningBlock === wf;
  }
  function matchesFilter(item, f) {
    if (f === 'all') return true;
    if (f === 'current') return !item.forecast || item.forecast === 'current';
    return item.forecast === f + 'h';
  }

  var filteredLows = forecast.lowCenters.filter(function (i) {
    return matchesFilter(i, filter);
  });
  var filteredWinds = forecast.windAreas.filter(function (i) {
    return matchesFilter(i, filter);
  });
  var filteredFog = forecast.fogAreas.filter(function (i) {
    return matchesFilter(i, filter);
  });
  var filteredSpray = forecast.freezingSprayLines.filter(function (i) {
    return matchesFilter(i, filter);
  });

  if (warningFilter !== 'all') {
    filteredLows = filteredLows.filter(function (i) {
      return matchesWarningFilter(i, warningFilter);
    });
    filteredWinds = filteredWinds.filter(function (i) {
      return matchesWarningFilter(i, warningFilter);
    });
  }

  // Fog (bottom)
  if (layerVisibility.fog) {
    for (var i = 0; i < filteredFog.length; i++) {
      var fog = filteredFog[i];
      if (fog.bounds.length >= 3) {
        L.polygon(normalizePolygonForDateline(fog.bounds), { color: '#6b7280', fillColor: '#6b7280', fillOpacity: 0.25, weight: 1 })
          .addTo(layerGroup)
          .bindPopup(
            '<div class="popup-header fog"><div class="popup-title"><span class="popup-badge fog">Fog</span>Dense Fog</div></div><div class="popup-body"><div class="popup-row"><span class="popup-label">Visibility</span><span class="popup-value">Reduced</span></div>' +
              (fog.forecast && fog.forecast !== 'current' ? '<div class="popup-forecast">Forecast: ' + fog.forecast + '</div>' : '') +
              '</div>'
          );
      }
    }
  }

  // Spray
  if (layerVisibility.spray) {
    for (var i = 0; i < filteredSpray.length; i++) {
      var spray = filteredSpray[i];
      if (spray.bounds.length >= 3) {
        L.polygon(normalizePolygonForDateline(spray.bounds), { color: '#06b6d4', fillColor: '#06b6d4', fillOpacity: 0.3, weight: 2 })
          .addTo(layerGroup)
          .bindPopup(
            '<div class="popup-header spray"><div class="popup-title"><span class="popup-badge spray">Spray</span>Freezing Spray</div></div><div class="popup-body"><div class="popup-row"><span class="popup-label">Severity</span><span class="popup-value">' +
              spray.severity +
              '</span></div>' +
              (spray.forecast && spray.forecast !== 'current' ? '<div class="popup-forecast">Forecast: ' + spray.forecast + '</div>' : '') +
              '</div>'
          );
      }
    }
  }

  // Wind areas (sorted by severity: sub-gale → gale → storm → hurricane; lows drawn on top after)
  var severityOrder = { 'SUB-GALE': 0, GALE: 1, STORM: 2, HURRICANE: 3 };
  var sortedWinds = filteredWinds.slice().sort(function (a, b) {
    return (severityOrder[a.warningType] || 0) - (severityOrder[b.warningType] || 0);
  });

  for (var i = 0; i < sortedWinds.length; i++) {
    var w = sortedWinds[i];
    var layerKey = 'gale',
      color = '#d97706',
      label = 'Gale Warning';
    if (w.warningType === 'HURRICANE') {
      layerKey = 'hurricane';
      color = '#a855f7';
      label = 'Hurricane Force Warning';
    } else if (w.warningType === 'STORM') {
      layerKey = 'storm';
      color = '#ef4444';
      label = 'Storm Warning';
    } else if (w.warningType === 'SUB-GALE') {
      layerKey = 'subgale';
      color = '#16a34a';
      label = 'Sub-Gale Winds';
    }
    if (!layerVisibility[layerKey]) continue;
    if (w.bounds.length >= 3) {
      var badgeClass = w.warningType === 'HURRICANE' ? 'hurricane' : w.warningType === 'STORM' ? 'storm' : 'gale';
      var badgeText = w.warningType === 'HURRICANE' ? 'Hurricane' : w.warningType === 'STORM' ? 'Storm' : w.warningType === 'SUB-GALE' ? 'Sub-Gale' : 'Gale';
      var areaRows = '';
      if (windAreaById && w.id && windAreaById.has(w.id)) {
        var am = windAreaById.get(w.id);
        if (am && typeof am.area_nm2 === 'number') {
          areaRows +=
            '<div class="popup-row"><span class="popup-label">Area</span><span class="popup-value">' +
            Math.round(am.area_nm2).toLocaleString() +
            ' nm²</span></div>';
          if (typeof am.area_water_nm2 === 'number') {
            areaRows +=
              '<div class="popup-row"><span class="popup-label">Water area</span><span class="popup-value">' +
              Math.round(am.area_water_nm2).toLocaleString() +
              ' nm²</span></div>';
          }
        }
      }
      var popup =
        '<div class="popup-header ' +
        badgeClass +
        '"><div class="popup-title"><span class="popup-badge ' +
        badgeClass +
        '">' +
        badgeText +
        '</span>' +
        label +
        '</div></div><div class="popup-body"><div class="popup-row"><span class="popup-label">Wind Speed</span><span class="popup-value highlight">' +
        w.windSpeed.min +
        '-' +
        w.windSpeed.max +
        ' KT</span></div>' +
        (w.seas ? '<div class="popup-row"><span class="popup-label">Sea Height</span><span class="popup-value">' + w.seas.min + '-' + w.seas.max + ' M</span></div>' : '') +
        areaRows +
        (w.forecast ? '<div class="popup-forecast">Forecast: ' + w.forecast + '</div>' : '') +
        (w.description ? '<div class="popup-source"><span class="popup-label">Source Text</span><div class="popup-source-text">' + w.description + '</div></div>' : '') +
        '</div>';
      L.polygon(normalizePolygonForDateline(w.bounds), { color: color, fillColor: color, fillOpacity: 0.2, weight: 2 }).addTo(layerGroup).bindPopup(popup);
    }
  }

  // Low centers (top)
  if (layerVisibility.lows) {
    for (var i = 0; i < filteredLows.length; i++) {
      var low = filteredLows[i];
      var mc = low.warningType === 'STORM' ? '#ef4444' : '#d97706';
      var icon = L.divIcon({
        className: 'low-marker',
        html:
          '<div style="background:' +
          mc +
          ';color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:bold;font-size:13px;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.2);">L</div><div style="background:rgba(0,0,0,0.65);color:#fff;font-size:9px;padding:1px 4px;border-radius:3px;margin-top:1px;text-align:center;white-space:nowrap;">' +
          low.pressure +
          ' mb</div>',
        iconSize: [36, 46],
        iconAnchor: [18, 23]
      });
      var lonDisp =
        low.position.lon > 0 ? (low.position.lon > 180 ? (360 - low.position.lon).toFixed(1) + 'W' : low.position.lon.toFixed(1) + 'E') : Math.abs(low.position.lon).toFixed(1) + 'W';
      var popup =
        '<div class="popup-header low"><div class="popup-title"><span class="popup-badge storm">Low</span>Low Pressure Center</div></div><div class="popup-body"><div class="popup-row"><span class="popup-label">Pressure</span><span class="popup-value highlight">' +
        low.pressure +
        ' mb</span></div><div class="popup-row"><span class="popup-label">Position</span><span class="popup-value">' +
        low.position.lat.toFixed(1) +
        'N ' +
        lonDisp +
        '</span></div>' +
        (low.movement ? '<div class="popup-row"><span class="popup-label">Movement</span><span class="popup-value">' + low.movement.direction + ' at ' + low.movement.speed + ' kt</span></div>' : '') +
        (low.forecast ? '<div class="popup-forecast">Forecast: ' + low.forecast + '</div>' : '') +
        '</div>';
      L.marker([low.position.lat, low.position.lon], { icon: icon }).addTo(layerGroup).bindPopup(popup);
    }
  }

  document.getElementById('stats-lows').textContent = filteredLows.length + ' Lows';
  document.getElementById('stats-winds').textContent = filteredWinds.length + ' Wind Areas';
  document.getElementById('stats-spray').textContent = filteredSpray.length + ' Spray Lines';
  if (forecast.validTime) document.getElementById('valid-time').textContent = 'Valid: ' + forecast.validTime;

  renderParsedOutput({
    lowCenters: filteredLows,
    windAreas: filteredWinds,
    freezingSprayLines: filteredSpray,
    fogAreas: filteredFog
  });
}

export function updateBoundary(area, layerVisibility) {
  if (boundaryLayer) boundaryLayer.remove();
  var bounds;
  if (area.crossesDateline && area.westBoundary) {
    bounds = [];
    for (var i = 0; i < area.westBoundary.length; i++) bounds.push([area.westBoundary[i].lat, area.westBoundary[i].lon]);
    bounds.push([area.north, area.east]);
    bounds.push([area.south, area.east]);
    bounds.push([area.westBoundary[0].lat, area.westBoundary[0].lon]);
  } else {
    bounds = [
      [area.north, area.west],
      [area.north, area.east],
      [area.south, area.east],
      [area.south, area.west]
    ];
  }
  boundaryLayer = L.polygon(bounds, { color: '#3b82f6', weight: 2, fillOpacity: 0, dashArray: '10, 5' });
  if (layerVisibility.boundary) boundaryLayer.addTo(map);
}
