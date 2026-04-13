import turf from '@turf/turf';

// Configurable forecast areas for different oceans
export const FORECAST_AREAS = {
  atlantic: {
    north: 67, south: 31, west: -80, east: -35,
    center: [50, -50], zoom: 4, crossesDateline: false
  },
  pacific: {
    north: 67, south: 30, west: 160, east: 250,
    center: [40, 190], zoom: 3, crossesDateline: true,
    westBoundary: [
      { lat: 30, lon: 160 },
      { lat: 50, lon: 160 },
      { lat: 65, lon: 190 }
    ]
  }
};

let FORECAST_AREA = FORECAST_AREAS.atlantic;

export function setForecastArea(ocean) {
  FORECAST_AREA = FORECAST_AREAS[ocean] || FORECAST_AREAS.atlantic;
  return FORECAST_AREA;
}

export function getForecastArea() {
  return FORECAST_AREA;
}

export function parseCoordinate(coord) {
  var match = coord.match(/(\d+(?:\.\d+)?)(N|S)(\d+(?:\.\d+)?)(W|E)/i);
  if (!match) return null;
  var lat = parseFloat(match[1]);
  var lon = parseFloat(match[3]);
  if (match[2].toUpperCase() === 'S') lat = -lat;
  if (match[4].toUpperCase() === 'W') {
    lon = FORECAST_AREA.crossesDateline ? 360 - lon : -lon;
  }
  return { lat: lat, lon: lon };
}

function toLon360(lon) { return lon < 0 ? lon + 360 : lon; }
function fromLon360(lon) { return lon > 180 ? lon - 360 : lon; }

function isLonInArea(lon, area) {
  if (!area.crossesDateline) return lon >= area.west && lon <= area.east;
  return lon >= area.west && lon <= area.east;
}

function parseCoordinatesFromLine(text) {
  var coords = [];
  var coordPattern = /(\d+(?:\.\d+)?)(N|S)(\d+(?:\.\d+)?)(W|E)/gi;
  var match;
  while ((match = coordPattern.exec(text)) !== null) {
    var coord = parseCoordinate(match[0]);
    if (coord) coords.push(coord);
  }
  return coords;
}

function clipLongitude(lon) {
  return Math.max(FORECAST_AREA.west, Math.min(FORECAST_AREA.east, lon));
}

function clipToForecastArea(coords) {
  if (coords.length === 0) return [];
  return coords.map(function(coord) {
    return {
      lat: Math.max(FORECAST_AREA.south, Math.min(FORECAST_AREA.north, coord.lat)),
      lon: clipLongitude(coord.lon)
    };
  });
}

function createPolygonFromBounds(northLat, southLat, eastLon, westLon) {
  var n = Math.min(northLat !== undefined ? northLat : FORECAST_AREA.north, FORECAST_AREA.north);
  var s = Math.max(southLat !== undefined ? southLat : FORECAST_AREA.south, FORECAST_AREA.south);
  var e, w;
  if (!FORECAST_AREA.crossesDateline) {
    e = Math.min(eastLon !== undefined ? eastLon : FORECAST_AREA.east, FORECAST_AREA.east);
    w = Math.max(westLon !== undefined ? westLon : FORECAST_AREA.west, FORECAST_AREA.west);
    if (n <= s || e <= w) return [];
  } else {
    e = eastLon !== undefined ? eastLon : FORECAST_AREA.east;
    w = westLon !== undefined ? westLon : FORECAST_AREA.west;
    if (n <= s) return [];
  }
  return [
    { lat: n, lon: w }, { lat: n, lon: e },
    { lat: s, lon: e }, { lat: s, lon: w }, { lat: n, lon: w }
  ];
}

function createSectorPolygon(center, radiusNm, direction, sectorType, innerRadiusNm) {
  innerRadiusNm = innerRadiusNm || null;
  var nmToDegreesLat = 1/60;
  var nmToDegreesLon = 1/(60*Math.cos(center.lat*Math.PI/180));
  var directionCenters = { N:0, NE:45, E:90, SE:135, S:180, SW:225, W:270, NW:315 };
  var halfSpan;
  if (sectorType === 'circle') halfSpan = 180;
  else if (sectorType === 'semicircle') halfSpan = 90;
  else halfSpan = 45;
  var centerBearing = directionCenters[direction.toUpperCase()] || 0;
  var startAngle = centerBearing - halfSpan;
  var endAngle = centerBearing + halfSpan;
  var points = [];
  if (innerRadiusNm !== null && innerRadiusNm > 0) {
    for (var angle = startAngle; angle <= endAngle; angle += 5) {
      var na = ((angle % 360) + 360) % 360;
      var mr = (90 - na) * Math.PI / 180;
      points.push({ lat: center.lat + radiusNm*nmToDegreesLat*Math.sin(mr), lon: center.lon + radiusNm*nmToDegreesLon*Math.cos(mr) });
    }
    for (var angle = endAngle; angle >= startAngle; angle -= 5) {
      var na = ((angle % 360) + 360) % 360;
      var mr = (90 - na) * Math.PI / 180;
      points.push({ lat: center.lat + innerRadiusNm*nmToDegreesLat*Math.sin(mr), lon: center.lon + innerRadiusNm*nmToDegreesLon*Math.cos(mr) });
    }
    points.push(points[0]);
  } else {
    if (sectorType !== 'circle') points.push(center);
    for (var angle = startAngle; angle <= endAngle; angle += 5) {
      var na = ((angle % 360) + 360) % 360;
      var mr = (90 - na) * Math.PI / 180;
      points.push({ lat: center.lat + radiusNm*nmToDegreesLat*Math.sin(mr), lon: center.lon + radiusNm*nmToDegreesLon*Math.cos(mr) });
    }
    if (sectorType !== 'circle') points.push(center);
    else points.push(points[0]);
  }
  return clipToForecastArea(points);
}

function createQuadrantPolygon(center, radiusNm, quadrants) {
  if (quadrants.length === 1) return createSectorPolygon(center, radiusNm, quadrants[0], 'quadrant');
  var allPoints = [center];
  for (var q = 0; q < quadrants.length; q++) {
    var sp = createSectorPolygon(center, radiusNm, quadrants[q], 'quadrant');
    for (var i = 1; i < sp.length - 1; i++) allPoints.push(sp[i]);
  }
  allPoints.push(center);
  return clipToForecastArea(allPoints);
}

function parseMovement(text) {
  var match = text.match(/MOVING\s+(N|NE|E|SE|S|SW|W|NW)\s+(\d+)\s*KT/i);
  return match ? { direction: match[1].toUpperCase(), speed: parseInt(match[2]) } : null;
}

function parseWindSpeed(text) {
  var match = text.match(/WINDS?\s+(\d+)\s+TO\s+(\d+)\s*KT/i);
  return match ? { min: parseInt(match[1]), max: parseInt(match[2]) } : null;
}

function parseSeas(text) {
  var match = text.match(/SEAS?\s+(?:TO\s+)?(\d+(?:\.\d+)?)\s*(?:TO\s+(\d+(?:\.\d+)?))?\s*M/i);
  if (!match) return null;
  var min = parseFloat(match[1]);
  return { min: min, max: match[2] ? parseFloat(match[2]) : min };
}

function getWarningTypeFromWindSpeed(maxWindKt) {
  if (maxWindKt >= 64) return 'HURRICANE';
  if (maxWindKt >= 48) return 'STORM';
  if (maxWindKt >= 34) return 'GALE';
  return 'SUB-GALE';
}

function extractLowCenterFromText(text) {
  var patterns = [
    /(?:MAIN\s+)?CENTER\s+(\d+[NS]\d+[WE])/i,
    /LOW\s+(\d+[NS]\d+[WE])/i,
    /(\d+[NS]\d+[WE])\s+\d+\s*MB/i
  ];
  for (var i = 0; i < patterns.length; i++) {
    var match = text.match(patterns[i]);
    if (match) return parseCoordinate(match[1]);
  }
  return null;
}

function parseQuadrantSpecs(text) {
  var specs = [];
  var match;
  var circlePattern = /WITHIN\s+(\d+)\s*NM\s+OF\s+LOW\s+CENTER/gi;
  while ((match = circlePattern.exec(text)) !== null) {
    specs.push({ radiusNm: parseInt(match[1]), direction: 'N', sectorType: 'circle' });
  }
  var annulusPattern = /BETWEEN\s+(\d+)\s*NM\s+AND\s+(\d+)\s*NM\s+(NE|NW|SE|SW|N|E|S|W)\s+(?:QUADRANT|SEMICIRCLE)/gi;
  while ((match = annulusPattern.exec(text)) !== null) {
    var isSemicircle = text.slice(match.index).toUpperCase().indexOf('SEMICIRCLE') > -1;
    specs.push({ radiusNm: parseInt(match[2]), innerRadiusNm: parseInt(match[1]), direction: match[3].toUpperCase(), sectorType: isSemicircle ? 'semicircle' : 'quadrant', isAnnulus: true });
  }
  var semicirclePattern = /(\d+)\s*NM\s+(NE|NW|SE|SW|N|E|S|W)\s+(?:AND\s+(NE|NW|SE|SW|N|E|S|W)\s+)?SEMICIRCLE/gi;
  while ((match = semicirclePattern.exec(text)) !== null) {
    if (specs.some(function(s) { return s.isAnnulus && s.radiusNm === parseInt(match[1]); })) continue;
    specs.push({ radiusNm: parseInt(match[1]), direction: match[2].toUpperCase(), sectorType: 'semicircle' });
    if (match[3]) specs.push({ radiusNm: parseInt(match[1]), direction: match[3].toUpperCase(), sectorType: 'semicircle' });
  }
  var multiQuadrantPattern = /(\d+)\s*NM\s+(NE|NW|SE|SW|N|E|S|W)(?:\s+AND\s+(NE|NW|SE|SW|N|E|S|W))?\s+(?:QUADRANTS?|QUARANTS?)/gi;
  while ((match = multiQuadrantPattern.exec(text)) !== null) {
    var radius = parseInt(match[1]);
    var dir1 = match[2].toUpperCase();
    var dir2 = match[3] ? match[3].toUpperCase() : null;
    var alreadyMatched = specs.some(function(s) { return (s.sectorType === 'circle' || s.sectorType === 'semicircle' || s.isAnnulus) && s.radiusNm === radius && s.direction === dir1; });
    if (alreadyMatched) continue;
    specs.push({ radiusNm: radius, direction: dir1, sectorType: 'quadrant' });
    if (dir2) specs.push({ radiusNm: radius, direction: dir2, sectorType: 'quadrant' });
  }
  return specs;
}

var GREENLAND_LON = -45;

function parseDirectionalBounds(text) {
  var bounds = {};
  var nOfMatch = text.match(/N\s+OF\s+(\d+)(N|S)/i);
  if (nOfMatch) { var lat = parseFloat(nOfMatch[1]); if (nOfMatch[2].toUpperCase() === 'S') lat = -lat; bounds.south = lat; }
  var sOfMatch = text.match(/S\s+OF\s+(\d+)(N|S)/i);
  if (sOfMatch) { var lat = parseFloat(sOfMatch[1]); if (sOfMatch[2].toUpperCase() === 'S') lat = -lat; bounds.north = lat; }
  if (text.match(/E\s+OF\s+GREENLAND/i)) { bounds.west = GREENLAND_LON; }
  else if (text.match(/W\s+OF\s+GREENLAND/i)) { bounds.east = GREENLAND_LON; }
  else {
    var eOfMatch = text.match(/E\s+OF\s+(\d+)(E|W)/i);
    if (eOfMatch) { var lon = parseFloat(eOfMatch[1]); if (eOfMatch[2].toUpperCase() === 'W') lon = FORECAST_AREA.crossesDateline ? 360-lon : -lon; bounds.west = lon; }
    var wOfMatch = text.match(/W\s+OF\s+(\d+)(E|W)/i);
    if (wOfMatch) { var lon = parseFloat(wOfMatch[1]); if (wOfMatch[2].toUpperCase() === 'W') lon = FORECAST_AREA.crossesDateline ? 360-lon : -lon; bounds.east = lon; }
  }
  return bounds;
}

function parseFromToBetween(text) {
  var result = {};
  var latMatch = text.match(/FROM\s+(\d+)(N|S)\s+TO\s+(\d+)(N|S)/i);
  if (latMatch) {
    var lat1 = parseFloat(latMatch[1]); var lat2 = parseFloat(latMatch[3]);
    if (latMatch[2].toUpperCase() === 'S') lat1 = -lat1;
    if (latMatch[4].toUpperCase() === 'S') lat2 = -lat2;
    result.latRange = [Math.min(lat1,lat2), Math.max(lat1,lat2)];
  }
  var lonMatch = text.match(/BETWEEN\s+(\d+)(E|W)\s+(?:AND|TO)\s+(\d+)(E|W)/i);
  if (lonMatch) {
    var lon1 = parseFloat(lonMatch[1]); var lon2 = parseFloat(lonMatch[3]);
    if (lonMatch[2].toUpperCase() === 'W') lon1 = FORECAST_AREA.crossesDateline ? 360-lon1 : -lon1;
    if (lonMatch[4].toUpperCase() === 'W') lon2 = FORECAST_AREA.crossesDateline ? 360-lon2 : -lon2;
    result.lonRange = [Math.min(lon1,lon2), Math.max(lon1,lon2)];
  }
  return result;
}

function lonLatForTurf(p) {
  var lon = p.lon;
  if (FORECAST_AREA.crossesDateline && lon > 180) lon -= 360;
  return [lon, p.lat];
}

/**
 * "EITHER SIDE OF A LINE" = all points within XX NM perpendicular to the polyline
 * (a filled corridor / band). That is one closed polygon; we return its outer boundary
 * as { lat, lon }[] for clipping. Turf buffer (km) approximates that region.
 */
function createLineBufferCorridor(linePoints, distanceNm) {
  if (linePoints.length < 2) return [];
  var distanceKm = distanceNm * 1.852;
  var coords = [];
  for (var i = 0; i < linePoints.length; i++) {
    coords.push(lonLatForTurf(linePoints[i]));
  }
  var line;
  try {
    line = turf.lineString(coords);
  } catch (e) {
    return [];
  }
  var buf;
  try {
    buf = turf.buffer(line, distanceKm, { units: 'kilometers' });
  } catch (e2) {
    return [];
  }
  if (!buf || !buf.geometry) return [];
  var g = buf.geometry;
  function ringToLatLon(ringCoords) {
    return ringCoords.slice(0, -1).map(function (c) {
      var lon = c[0];
      var lat = c[1];
      if (FORECAST_AREA.crossesDateline && lon < 0) lon += 360;
      return { lat: lat, lon: lon };
    });
  }
  if (g.type === 'Polygon') {
    return ringToLatLon(g.coordinates[0]);
  }
  if (g.type === 'MultiPolygon') {
    var bestRing = null;
    var bestArea = -1;
    for (var pi = 0; pi < g.coordinates.length; pi++) {
      try {
        var poly = turf.polygon(g.coordinates[pi]);
        var a = turf.area(poly);
        if (a > bestArea) {
          bestArea = a;
          bestRing = g.coordinates[pi][0];
        }
      } catch (e3) {
        continue;
      }
    }
    if (!bestRing) return [];
    return ringToLatLon(bestRing);
  }
  return [];
}

function createLineBufferPolygon(linePoints, distanceNm, directions) {
  if (linePoints.length < 2) return [];
  var nmToDegreesLat = 1 / 60;
  var directionBearings = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  var bearings = [];
  for (var d = 0; d < directions.length; d++) {
    var b = directionBearings[directions[d].toUpperCase()];
    if (b !== undefined) bearings.push(b);
  }
  if (bearings.length === 0) return [];

  function offsetPoint(pt, bearing) {
    var nmToDegreesLon = 1 / (60 * Math.cos((pt.lat * Math.PI) / 180));
    var rad = ((((bearing % 360) + 360) % 360) * Math.PI) / 180;
    return {
      lat: pt.lat + distanceNm * nmToDegreesLat * Math.cos(rad),
      lon: pt.lon + distanceNm * nmToDegreesLon * Math.sin(rad)
    };
  }

  // Collect all points: original line + each line point offset at each bearing
  var allPoints = [];
  for (var i = 0; i < linePoints.length; i++) {
    allPoints.push(linePoints[i]);
    for (var b = 0; b < bearings.length; b++) {
      allPoints.push(offsetPoint(linePoints[i], bearings[b]));
    }
  }

  // Convex hull ensures no self-intersection or overlap
  var hull = convexHull(allPoints);
  hull.push(hull[0]); // close
  return hull;
}

// Convex hull (Andrew's monotone chain) — works for any small point set
function convexHull(points) {
  var pts = points.slice().sort(function(a, b) {
    return a.lon - b.lon || a.lat - b.lat;
  });

  if (pts.length <= 2) return pts;

  function cross(O, A, B) {
    return (A.lon - O.lon) * (B.lat - O.lat) - (A.lat - O.lat) * (B.lon - O.lon);
  }

  var lower = [];
  for (var i = 0; i < pts.length; i++) {
    while (lower.length >= 2 && cross(lower[lower.length-2], lower[lower.length-1], pts[i]) <= 0)
      lower.pop();
    lower.push(pts[i]);
  }

  var upper = [];
  for (var i = pts.length - 1; i >= 0; i--) {
    while (upper.length >= 2 && cross(upper[upper.length-2], upper[upper.length-1], pts[i]) <= 0)
      upper.pop();
    upper.push(pts[i]);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function parseFrontLineArea(text, contextLowCenter) {
  var eitherMatch = text.match(/WITHIN\s+(\d+)\s*NM\s+EITHER\s+SIDE\s+OF\s+A\s+LINE\s+FROM\s+(.+?)(?:\s+WINDS|\s+SEAS|\s*$)/i);
  if (eitherMatch) {
    var distanceNmE = parseFloat(eitherMatch[1]);
    var pointStringsE = eitherMatch[2].split(/\s+TO\s+/i);
    var linePointsE = [];
    for (var ei = 0; ei < pointStringsE.length; ei++) {
      var trimmedE = pointStringsE[ei].trim();
      if (!trimmedE) continue;
      if (/^(?:THE\s+)?LOW(?:\s+CENTER)?$/i.test(trimmedE)) {
        if (contextLowCenter) linePointsE.push(contextLowCenter);
      } else {
        var coordE = parseCoordinate(trimmedE);
        if (coordE) linePointsE.push(coordE);
      }
    }
    if (linePointsE.length >= 2) {
      var boundsE = createLineBufferCorridor(linePointsE, distanceNmE);
      if (boundsE.length >= 3) {
        return {
          bounds: clipPolygonToBounds(boundsE),
          distanceNm: distanceNmE,
          directions: ['EITHER_SIDE'],
          linePoints: linePointsE
        };
      }
    }
  }

  var withinMatch = text.match(/WITHIN\s+(\d+)\s*NM\s+([NESW]+(?:\s+AND\s+[NESW]+)*)\s+OF\s+A\s+(?:FRONT|LINE)/i);
  if (!withinMatch) return null;
  var distanceNm = parseFloat(withinMatch[1]);
  var directionsStr = withinMatch[2].toUpperCase();
  var fromMatch = text.match(/(?:FRONT|LINE)\s+(?:(?:TO\s+)?EXTEND(?:ING)?\s+)?FROM\s+(.+?)(?:\s+WINDS|\s+SEAS|\s*$)/i);
  if (!fromMatch) return null;
  var pointStrings = fromMatch[1].split(/\s+TO\s+/i);
  var linePoints = [];
  for (var i = 0; i < pointStrings.length; i++) {
    var trimmed = pointStrings[i].trim();
    if (!trimmed) continue;
    if (/^(?:THE\s+)?LOW(?:\s+CENTER)?$/i.test(trimmed)) { if (contextLowCenter) linePoints.push(contextLowCenter); }
    else { var coord = parseCoordinate(trimmed); if (coord) linePoints.push(coord); }
  }
  if (linePoints.length < 2) return null;
  var directions = directionsStr.split(/\s+AND\s+/).map(function(d) { return d.trim(); });
  var bounds = createLineBufferPolygon(linePoints, distanceNm, directions);
  return { bounds: clipPolygonToBounds(bounds), distanceNm: distanceNm, directions: directions, linePoints: linePoints };
}

function createPolygonFromLineAndDirection(linePoints, direction) {
  if (linePoints.length < 2) return [];
  var points = linePoints.slice();
  var first = points[0]; var last = points[points.length-1];
  switch (direction.toUpperCase()) {
    case 'W': points.push({lat:last.lat,lon:FORECAST_AREA.west}); points.push({lat:first.lat,lon:FORECAST_AREA.west}); break;
    case 'E': points.push({lat:last.lat,lon:FORECAST_AREA.east}); points.push({lat:first.lat,lon:FORECAST_AREA.east}); break;
    case 'N': points.push({lat:FORECAST_AREA.north,lon:last.lon}); points.push({lat:FORECAST_AREA.north,lon:first.lon}); break;
    case 'S': points.push({lat:FORECAST_AREA.south,lon:last.lon}); points.push({lat:FORECAST_AREA.south,lon:first.lon}); break;
  }
  points.push(first);
  return clipToForecastArea(points);
}

function parseFreezingSprayAreas(text) {
  var areas = [];
  if (!text || typeof text !== 'string') return areas;
  var sections = text.split(/(?=\.(\d+)\s*HOUR\s*FORECAST|\.{3}HEAVY\s+FREEZING|\.{3}FREEZING\s+SPRAY)/i);
  for (var si = 0; si < sections.length; si++) {
    var section = sections[si];
    if (!section || typeof section !== 'string') continue;
    var forecastHour = 'current';
    var hourMatch = section.match(/^\.?(\d+)\s*HOUR\s*FORECAST/i);
    if (hourMatch) forecastHour = hourMatch[1] + 'h';
    var sprayPattern = /(MODERATE TO HEAVY|HEAVY|LIGHT TO MODERATE|LIGHT)\s+FREEZING SPRAY\s+(W|E|N|S)\s+OF\s+A\s+LINE\s+FROM\s+([\d\w\s]+?)(?=\.\s*ELSEWHERE|\.\s*$|\.{3})/gi;
    var match;
    while ((match = sprayPattern.exec(section)) !== null) {
      var severity = match[1].toLowerCase().indexOf('heavy') > -1 ? 'heavy' : 'moderate';
      var direction = match[2].toUpperCase();
      var coords = parseCoordinatesFromLine(match[3]);
      if (coords.length >= 2) {
        var bounds = createPolygonFromLineAndDirection(coords, direction);
        if (bounds.length >= 3) areas.push({ id: 'freeze-'+severity+'-'+areas.length, bounds: bounds, severity: severity, direction: direction, forecast: forecastHour });
      }
    }
  }
  return areas;
}
var parseFreezingSprayLines = parseFreezingSprayAreas;

function parseWindAreas(text, sectionWarningType, baseId, contextLowCenter) {
  var windSpeed = parseWindSpeed(text);
  if (!windSpeed) return [];
  var warningType = getWarningTypeFromWindSpeed(windSpeed.max);
  var seas = parseSeas(text);
  var description = text.trim();
  var results = [];
  var andParts = text.split(/\s+AND\s+(?=FROM\s+\d|[NESW]\s+OF\s+\d)/i);
  if (andParts.length > 1) {
    for (var i = 0; i < andParts.length; i++) {
      var subResults = parseWindAreas(andParts[i] + ' WINDS ' + windSpeed.min + ' TO ' + windSpeed.max + ' KT', sectionWarningType, baseId + '-and' + i, contextLowCenter);
      results.push.apply(results, subResults);
    }
    if (results.length > 0) return results;
  }
  if (/\b(?:FRONT|LINE)\s+(?:TO\s+EXTEND|EXTENDING|FROM)\b/i.test(text) || /\bEITHER\s+SIDE\s+OF\s+A\s+LINE\b/i.test(text)) {
    var frontArea = parseFrontLineArea(text, contextLowCenter);
    if (frontArea && frontArea.bounds.length >= 3) {
      results.push({ id: baseId + '-front', type: 'front-buffer', bounds: frontArea.bounds, windSpeed: windSpeed, seas: seas || undefined, warningType: warningType, description: description, distanceNm: frontArea.distanceNm, directions: frontArea.directions });
      var frontPattern = /WITHIN\s+\d+\s*NM\s+[NESW]+(?:\s+AND\s+[NESW]+)*\s+OF\s+A\s+(?:FRONT|LINE)\s*(?:(?:TO\s+)?EXTEND(?:ING)?\s+)?FROM\s+(?:(?:THE\s+)?LOW(?:\s+CENTER)?|\d+(?:\.\d+)?[NS]\d+(?:\.\d+)?[EW])(?:\s+TO\s+(?:(?:THE\s+)?LOW(?:\s+CENTER)?|\d+(?:\.\d+)?[NS]\d+(?:\.\d+)?[EW]))+/gi;
      var eitherStrip = /WITHIN\s+\d+\s*NM\s+EITHER\s+SIDE\s+OF\s+A\s+LINE\s+FROM\s+[\d\w\s]+?(?=\s+WINDS|\s+SEAS|\s*$)/gi;
      text = text.replace(frontPattern, ' ').replace(eitherStrip, ' ').replace(/\s+/g, ' ').trim();
    }
  }
  if ((text.indexOf('WITHIN') > -1 || text.indexOf('BETWEEN') > -1) && text.indexOf('NM') > -1) {
    var sectorSpecs = parseQuadrantSpecs(text);
    var lowCenter = extractLowCenterFromText(text) || contextLowCenter;
    if (sectorSpecs.length > 0 && lowCenter) {
      for (var i = 0; i < sectorSpecs.length; i++) {
        var spec = sectorSpecs[i];
        var bounds = createSectorPolygon(lowCenter, spec.radiusNm, spec.direction, spec.sectorType, spec.innerRadiusNm || null);
        bounds = clipPolygonToBounds(bounds);
        if (bounds.length >= 3) {
          results.push({ id: baseId + '-q' + i, type: spec.sectorType, bounds: bounds, windSpeed: windSpeed, seas: seas || undefined, warningType: warningType, description: description, direction: spec.direction, sectorType: spec.sectorType, radiusNm: spec.radiusNm });
        }
      }
      if (results.length > 0) return results;
    }
  }
  var bounds = [];
  var fromTo = parseFromToBetween(text);
  if (fromTo.latRange && fromTo.lonRange) {
    bounds = createPolygonFromBounds(fromTo.latRange[1], fromTo.latRange[0], fromTo.lonRange[1], fromTo.lonRange[0]);
  } else if (fromTo.latRange) {
    var dirBounds = parseDirectionalBounds(text);
    bounds = createPolygonFromBounds(fromTo.latRange[1], fromTo.latRange[0], dirBounds.east, dirBounds.west);
  }
  if (bounds.length < 3) {
    var dirBounds = parseDirectionalBounds(text);
    var ft = parseFromToBetween(text);
    if (ft.lonRange) {
      if (dirBounds.west === undefined) dirBounds.west = ft.lonRange[0];
      if (dirBounds.east === undefined) dirBounds.east = ft.lonRange[1];
    }
    if (Object.keys(dirBounds).length > 0) bounds = createPolygonFromBounds(dirBounds.north, dirBounds.south, dirBounds.east, dirBounds.west);
  }
  if (bounds.length >= 3) {
    bounds = clipPolygonToBounds(bounds);
    if (bounds.length >= 3) results.push({ id: baseId, type: 'polygon', bounds: bounds, windSpeed: windSpeed, seas: seas || undefined, warningType: warningType, description: description });
  }
  return results;
}

export function parseForecast(text) {
  // Truncate at the first forecaster sign-off line — everything after
  // belongs to a different center (e.g. NHC) and should not be parsed.
  var forecasterIdx = text.search(/\.FORECASTER\s+\w+.*?PREDICTION\s+CENTER\b/i);
  if (forecasterIdx > -1) {
    text = text.substring(0, forecasterIdx);
  }

  var result = { validTime: '', lowCenters: [], windAreas: [], freezingSprayLines: [], fogAreas: [], warningBlocks: [], rawText: text };
  var validMatch = text.match(/VALID\s+(\d+\s+UTC\s+\w+\s+\d+)/i);
  if (validMatch) result.validTime = validMatch[1];
  var warningBlocks = text.split(/(?=\.{3}[A-Z]+\s+WARNING\.{3}|…[A-Z]+\s+WARNING…)/i);
  var globalWarningId = 0; var blockIndex = 0;
  var fogPattern = /\.(?:(\d+)\s*HOUR\s*FORECAST\s+)?DENSE\s+FOG[^.]*FROM\s+(\d+)(N|S)\s+TO\s+(\d+)(N|S)\s+BETWEEN\s+(\d+)(W|E)\s+(?:AND|TO)\s+(\d+)(W|E)/gi;
  var fogMatch;
  while ((fogMatch = fogPattern.exec(text)) !== null) {
    var fh = fogMatch[1] ? fogMatch[1] + 'h' : 'current';
    var lat1 = parseFloat(fogMatch[2]); var lat2 = parseFloat(fogMatch[4]);
    if (fogMatch[3].toUpperCase() === 'S') lat1 = -lat1;
    if (fogMatch[5].toUpperCase() === 'S') lat2 = -lat2;
    var lon1 = parseFloat(fogMatch[6]); var lon2 = parseFloat(fogMatch[8]);
    if (fogMatch[7].toUpperCase() === 'W') lon1 = FORECAST_AREA.crossesDateline ? 360-lon1 : -lon1;
    if (fogMatch[9].toUpperCase() === 'W') lon2 = FORECAST_AREA.crossesDateline ? 360-lon2 : -lon2;
    var fb = createPolygonFromBounds(Math.max(lat1,lat2), Math.min(lat1,lat2), Math.max(lon1,lon2), Math.min(lon1,lon2));
    if (fb.length >= 3) result.fogAreas.push({ id: 'fog-'+result.fogAreas.length, bounds: fb, forecast: fh });
  }
  result.freezingSprayLines.push.apply(result.freezingSprayLines, parseFreezingSprayLines(text));

  for (var bi = 0; bi < warningBlocks.length; bi++) {
    var block = warningBlocks[bi];
    var warningType = 'GENERAL'; var blockName = null;
    if (block.indexOf('HURRICANE FORCE') > -1 || block.indexOf('HURRICANE WARNING') > -1) { warningType = 'HURRICANE'; blockName = 'Hurricane Warning ' + (++blockIndex); }
    else if (block.indexOf('STORM WARNING') > -1) { warningType = 'STORM'; blockName = 'Storm Warning ' + (++blockIndex); }
    else if (block.indexOf('GALE WARNING') > -1) { warningType = 'GALE'; blockName = 'Gale Warning ' + (++blockIndex); }
    else continue;
    if (blockName && result.warningBlocks.indexOf(blockName) === -1) result.warningBlocks.push(blockName);
    var cleanBlock = block;
    var fi = block.search(/\.FORECASTER\s+/i);
    if (fi > -1) cleanBlock = block.substring(0, fi);
    var forecastPeriods = cleanBlock.split(/(?=\.\s*\d+\s*(?:HOUR|HR)\s*FORECAST)/i);
    for (var pi = 0; pi < forecastPeriods.length; pi++) {
      var period = forecastPeriods[pi];
      var forecastHour = 'current';
      var hm = period.match(/\.?\s*(\d+)\s*(?:HOUR|HR)\s*FORECAST/i);
      if (hm) forecastHour = hm[1] + 'h';
      var contextLowCenter = null;
      var normalizedPeriod = period.replace(/\.{3}/g, ' ').replace(/\.{2}/g, ' ').replace(/\s+/g, ' ').trim();
      var lowPatterns = [
        /(?:MAIN\s+)?CENTER\s+(?:NEAR\s+)?(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi,
        /(?:SECOND\s+)?CENTER\s+(?:NEAR\s+)?(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi,
        /CENTER\s+(?:W|E|N|S)\s+OF\s+(?:AREA\s+)?(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi,
        /LOW\s+(?:INLAND\s+)?(?:NW\s+OF\s+AREA\s+)?(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi,
        /NEW\s+(?:SECOND\s+)?(?:LOW|CENTER)\s+(?:NEAR\s+)?(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi,
        /INTENSIFYING\s+LOW\s+(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi,
        /FORECAST\s+(?:COMPLEX\s+LOW\s+WITH\s+)?(?:MAIN\s+)?(?:CENTER\s+)?(?:NEAR\s+)?(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi,
        /FORECAST\s+(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi
      ];
      var seenLows = {};
      for (var lp = 0; lp < lowPatterns.length; lp++) {
        var lm;
        while ((lm = lowPatterns[lp].exec(normalizedPeriod)) !== null) {
          var coord = parseCoordinate(lm[1]);
          if (coord) {
            var lowKey = coord.lat + '-' + coord.lon + '-' + lm[2];
            if (seenLows[lowKey]) continue;
            seenLows[lowKey] = true;
            result.lowCenters.push({ id: 'low-'+coord.lat+'-'+coord.lon+'-'+result.lowCenters.length, position: coord, pressure: parseInt(lm[2]), movement: parseMovement(normalizedPeriod), warningType: warningType, warningBlock: blockName, forecast: forecastHour });
            contextLowCenter = coord;
          }
        }
      }
      if (normalizedPeriod.indexOf('WINDS') > -1 && normalizedPeriod.indexOf('KT') > -1) {
        var windClauses = normalizedPeriod.split(/(?:\.\s*|\s+)(?:ALSO|ELSEWHERE)\s+/i);
        for (var ci = 0; ci < windClauses.length; ci++) {
          var clause = windClauses[ci];
          if (clause && clause.indexOf('WINDS') > -1 && clause.indexOf('KT') > -1) {
            var ec = extractLowCenterFromText(clause);
            var windAreas = parseWindAreas(clause, warningType, 'wind-' + (globalWarningId++), ec || contextLowCenter);
            for (var wi = 0; wi < windAreas.length; wi++) { windAreas[wi].forecast = forecastHour; windAreas[wi].warningBlock = blockName; result.windAreas.push(windAreas[wi]); }
          }
        }
      }
    }
  }
  if (result.windAreas.length === 0 && result.lowCenters.length === 0) {
    var hasWinds = text.indexOf('WINDS') > -1 && text.indexOf('KT') > -1;
    var hasLow = /\.?LOW\s+\d+[NS]\d+[WE]/i.test(text);
    if (hasWinds || hasLow) {
      var nt = text.replace(/\.{3}/g,' ').replace(/\.{2}/g,' ').replace(/\s+/g,' ').trim();
      var ctxLow = null;
      var lp2 = /\.?(?:RAPIDLY\s+)?(?:INTENSIFYING\s+)?LOW\s+(\d+[NS]\d+[WE])\s+(\d+)\s*MB/gi;
      var lm2;
      while ((lm2 = lp2.exec(nt)) !== null) {
        var c = parseCoordinate(lm2[1]);
        if (c) { result.lowCenters.push({ id:'low-'+c.lat+'-'+c.lon+'-'+result.lowCenters.length, position:c, pressure:parseInt(lm2[2]), movement:parseMovement(nt), warningType:'GALE', forecast:'current' }); ctxLow = c; }
      }
      if (hasWinds) {
        var ws = parseWindSpeed(nt);
        var wt = ws ? getWarningTypeFromWindSpeed(ws.max) : 'GALE';
        var wc = nt.split(/(?:\.\s*|\s+)(?:ALSO|ELSEWHERE)\s+/i);
        for (var i = 0; i < wc.length; i++) {
          if (wc[i] && wc[i].indexOf('WINDS')>-1 && wc[i].indexOf('KT')>-1) {
            var ec = extractLowCenterFromText(wc[i]);
            var wa = parseWindAreas(wc[i], wt, 'wind-'+result.windAreas.length, ec||ctxLow);
            for (var j=0;j<wa.length;j++){wa[j].forecast='current';result.windAreas.push(wa[j]);}
          }
        }
      }
    }
  }
  return result;
}

export function getForecastAreaBounds() {
  return [{lat:FORECAST_AREA.north,lon:FORECAST_AREA.west},{lat:FORECAST_AREA.north,lon:FORECAST_AREA.east},{lat:FORECAST_AREA.south,lon:FORECAST_AREA.east},{lat:FORECAST_AREA.south,lon:FORECAST_AREA.west},{lat:FORECAST_AREA.north,lon:FORECAST_AREA.west}];
}

export function clipPolygonToBounds(polygon) {
  if (!polygon || polygon.length < 3) return polygon;
  var bounds = { north:FORECAST_AREA.north, south:FORECAST_AREA.south, west:FORECAST_AREA.west, east:FORECAST_AREA.east };
  var result = polygon;
  result = clipToEdge(result, function(p){return p.lat<=bounds.north;}, function(p1,p2){var t=(bounds.north-p1.lat)/(p2.lat-p1.lat);return{lat:bounds.north,lon:p1.lon+t*(p2.lon-p1.lon)};});
  result = clipToEdge(result, function(p){return p.lat>=bounds.south;}, function(p1,p2){var t=(bounds.south-p1.lat)/(p2.lat-p1.lat);return{lat:bounds.south,lon:p1.lon+t*(p2.lon-p1.lon)};});
  result = clipToEdge(result, function(p){return p.lon>=bounds.west;}, function(p1,p2){var t=(bounds.west-p1.lon)/(p2.lon-p1.lon);return{lat:p1.lat+t*(p2.lat-p1.lat),lon:bounds.west};});
  result = clipToEdge(result, function(p){return p.lon<=bounds.east;}, function(p1,p2){var t=(bounds.east-p1.lon)/(p2.lon-p1.lon);return{lat:p1.lat+t*(p2.lat-p1.lat),lon:bounds.east};});
  return result;
}

function clipToEdge(polygon, isInside, intersect) {
  if (!polygon || polygon.length === 0) return [];
  var output = [];
  for (var i = 0; i < polygon.length; i++) {
    var current = polygon[i]; var next = polygon[(i+1)%polygon.length];
    var ci = isInside(current); var ni = isInside(next);
    if (ci) { output.push(current); if (!ni) output.push(intersect(current,next)); }
    else if (ni) { output.push(intersect(current,next)); }
  }
  return output;
}

export function normalizePolygonForDateline(coords) {
  return coords.map(function(c) { return [c.lat, c.lon]; });
}
