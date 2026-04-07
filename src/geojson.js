import { getForecastArea } from './parser.js';

function matchesWarningFilter(item, filter) {
  return filter === 'all' || item.warningBlock === filter;
}

function matchesFilter(item, filter) {
  if (filter === 'all') return true;
  if (filter === 'current') return !item.forecast || item.forecast === 'current';
  return item.forecast === filter + 'h';
}

/**
 * Convert internal bounds [{lat,lon},...] to GeoJSON ring [[lon,lat],...]
 * Handles Pacific 0-360 → -180/180 conversion for valid GeoJSON output.
 */
export function boundsToGeoJSONRing(bounds, area) {
  var ring = [];
  for (var i = 0; i < bounds.length; i++) {
    var lon = bounds[i].lon;
    // Convert Pacific 0-360 system back to standard -180/180 for GeoJSON
    if (area.crossesDateline && lon > 180) lon = lon - 360;
    ring.push([lon, bounds[i].lat]);
  }
  // Ensure ring is closed
  if (ring.length > 0 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])) {
    ring.push(ring[0]);
  }
  return ring;
}

/**
 * @param {object} opts
 * @param {object} opts.forecast - parsed forecast
 * @param {string} opts.ocean - 'atlantic' | 'pacific'
 * @param {string} opts.filter - hour filter key
 * @param {string} opts.warningFilter - warning block or 'all'
 * @param {Map<string,{area_nm2:number,area_water_nm2:number}>|null} [opts.windAreaMetrics]
 */
export function exportGeoJSON(opts) {
  var forecast = opts.forecast;
  if (!forecast) {
    alert('No forecast loaded.');
    return;
  }

  var currentOcean = opts.ocean || 'atlantic';
  var currentFilter = opts.filter || 'all';
  var currentWarning = opts.warningFilter || 'all';
  var windAreaMetrics = opts.windAreaMetrics;
  var area = getForecastArea();

  var features = [];

  // Wind areas
  var winds = forecast.windAreas.filter(function (i) {
    return matchesFilter(i, currentFilter);
  });
  if (currentWarning !== 'all') winds = winds.filter(function (i) {
    return matchesWarningFilter(i, currentWarning);
  });

  for (var i = 0; i < winds.length; i++) {
    var w = winds[i];
    if (!w.bounds || w.bounds.length < 3) continue;
    var props = {
      id: w.id,
      featureType: 'wind_area',
      warningType: w.warningType,
      windSpeedMin_kt: w.windSpeed.min,
      windSpeedMax_kt: w.windSpeed.max,
      seasMin_m: w.seas ? w.seas.min : null,
      seasMax_m: w.seas ? w.seas.max : null,
      forecast: w.forecast || 'current',
      warningBlock: w.warningBlock || null,
      geometryType: w.type || 'polygon',
      description: w.description || null
    };
    if (windAreaMetrics && windAreaMetrics.has(w.id)) {
      var m = windAreaMetrics.get(w.id);
      props.area_nm2 = m.area_nm2;
      props.area_water_nm2 = m.area_water_nm2;
    }
    features.push({
      type: 'Feature',
      properties: props,
      geometry: {
        type: 'Polygon',
        coordinates: [boundsToGeoJSONRing(w.bounds, area)]
      }
    });
  }

  // Low pressure centers
  var lows = forecast.lowCenters.filter(function (i) {
    return matchesFilter(i, currentFilter);
  });
  if (currentWarning !== 'all') lows = lows.filter(function (i) {
    return matchesWarningFilter(i, currentWarning);
  });

  for (var i = 0; i < lows.length; i++) {
    var low = lows[i];
    var lon = area.crossesDateline && low.position.lon > 180 ? low.position.lon - 360 : low.position.lon;
    features.push({
      type: 'Feature',
      properties: {
        id: low.id,
        featureType: 'low_pressure_center',
        warningType: low.warningType,
        pressure_mb: low.pressure,
        movementDirection: low.movement ? low.movement.direction : null,
        movementSpeed_kt: low.movement ? low.movement.speed : null,
        forecast: low.forecast || 'current',
        warningBlock: low.warningBlock || null
      },
      geometry: {
        type: 'Point',
        coordinates: [lon, low.position.lat]
      }
    });
  }

  // Freezing spray
  var spray = forecast.freezingSprayLines.filter(function (i) {
    return matchesFilter(i, currentFilter);
  });
  for (var i = 0; i < spray.length; i++) {
    var s = spray[i];
    if (!s.bounds || s.bounds.length < 3) continue;
    features.push({
      type: 'Feature',
      properties: {
        id: s.id,
        featureType: 'freezing_spray',
        severity: s.severity,
        direction: s.direction,
        forecast: s.forecast || 'current'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [boundsToGeoJSONRing(s.bounds, area)]
      }
    });
  }

  // Fog areas
  var fog = forecast.fogAreas.filter(function (i) {
    return matchesFilter(i, currentFilter);
  });
  for (var i = 0; i < fog.length; i++) {
    var f = fog[i];
    if (!f.bounds || f.bounds.length < 3) continue;
    features.push({
      type: 'Feature',
      properties: {
        id: f.id,
        featureType: 'dense_fog',
        forecast: f.forecast || 'current'
      },
      geometry: {
        type: 'Polygon',
        coordinates: [boundsToGeoJSONRing(f.bounds, area)]
      }
    });
  }

  var geojson = {
    type: 'FeatureCollection',
    metadata: {
      source: 'OPC High Seas Forecast',
      ocean: currentOcean,
      validTime: forecast.validTime || null,
      exportedAt: new Date().toISOString(),
      filter: currentFilter,
      warningFilter: currentWarning,
      filters: { hour: currentFilter, warning: currentWarning },
      featureCount: features.length
    },
    features: features
  };

  var blob = new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = currentOcean + '_forecast_' + new Date().toISOString().slice(0, 10) + '.geojson';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
