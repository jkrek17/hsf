import turf from '@turf/turf';

const NM2_PER_M2 = 1 / 3429904;

let landMaskPromise = null;
let mergedLandFeature = null;

function lonForTurf(lon, crossesDateline) {
  if (crossesDateline && lon > 180) return lon - 360;
  return lon;
}

function boundsToTurfRing(bounds, forecastArea) {
  const crosses = forecastArea.crossesDateline;
  const ring = [];
  for (let i = 0; i < bounds.length; i++) {
    const lat = bounds[i].lat;
    const lon = lonForTurf(bounds[i].lon, crosses);
    ring.push([lon, lat]);
  }
  if (ring.length > 0) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  }
  return ring;
}

function mergeLand(fc) {
  if (!fc || !fc.features || fc.features.length === 0) return null;
  try {
    return turf.union(turf.featureCollection(fc.features));
  } catch {
    return null;
  }
}

export async function loadLandMask() {
  if (landMaskPromise) return landMaskPromise;
  landMaskPromise = fetch('/land.geojson')
    .then((r) => {
      if (!r.ok) throw new Error('Land mask HTTP ' + r.status);
      return r.json();
    })
    .then((geojson) => {
      mergedLandFeature = mergeLand(geojson);
      return geojson;
    })
    .catch((e) => {
      landMaskPromise = null;
      throw e;
    });
  return landMaskPromise;
}

function areaNm2(sqm) {
  return sqm * NM2_PER_M2;
}

/**
 * Compute total and water-only areas (nm²) for wind polygons, grouped by GALE / STORM / HURRICANE.
 */
export function computeAreas(windAreas, forecastArea) {
  const groups = {
    GALE: { total_nm2: 0, water_nm2: 0, count: 0 },
    STORM: { total_nm2: 0, water_nm2: 0, count: 0 },
    HURRICANE: { total_nm2: 0, water_nm2: 0, count: 0 }
  };

  if (!windAreas || !forecastArea) return groups;

  for (let i = 0; i < windAreas.length; i++) {
    const w = windAreas[i];
    const wt = w.warningType;
    if (wt !== 'GALE' && wt !== 'STORM' && wt !== 'HURRICANE') continue;
    if (!w.bounds || w.bounds.length < 3) continue;

    let ring;
    try {
      ring = boundsToTurfRing(w.bounds, forecastArea);
    } catch {
      continue;
    }
    if (ring.length < 4) continue;

    let poly;
    try {
      poly = turf.polygon([ring]);
    } catch {
      continue;
    }

    let totalM2 = 0;
    let waterM2 = 0;
    try {
      totalM2 = turf.area(poly);
    } catch {
      continue;
    }

    if (mergedLandFeature && mergedLandFeature.geometry) {
      try {
        const water = turf.difference(turf.featureCollection([poly, mergedLandFeature]));
        waterM2 = water && water.geometry ? turf.area(water) : 0;
      } catch {
        waterM2 = totalM2;
      }
    } else {
      waterM2 = totalM2;
    }

    groups[wt].total_nm2 += areaNm2(totalM2);
    groups[wt].water_nm2 += areaNm2(waterM2);
    groups[wt].count += 1;
  }

  return groups;
}

/**
 * Per-polygon areas for GeoJSON export (nm²). Skips non wind_area types.
 */
export function computeWindPolygonAreas(windAreas, forecastArea) {
  const out = [];
  if (!windAreas || !forecastArea) return out;

  for (let i = 0; i < windAreas.length; i++) {
    const w = windAreas[i];
    if (!w.bounds || w.bounds.length < 3) continue;

    let ring;
    try {
      ring = boundsToTurfRing(w.bounds, forecastArea);
    } catch {
      continue;
    }
    if (ring.length < 4) continue;

    let poly;
    try {
      poly = turf.polygon([ring]);
    } catch {
      continue;
    }

    let totalM2 = 0;
    let waterM2 = 0;
    try {
      totalM2 = turf.area(poly);
    } catch {
      continue;
    }

    if (mergedLandFeature && mergedLandFeature.geometry) {
      try {
        const water = turf.difference(turf.featureCollection([poly, mergedLandFeature]));
        waterM2 = water && water.geometry ? turf.area(water) : 0;
      } catch {
        waterM2 = totalM2;
      }
    } else {
      waterM2 = totalM2;
    }

    out.push({
      id: w.id,
      area_nm2: areaNm2(totalM2),
      area_water_nm2: areaNm2(waterM2)
    });
  }

  return out;
}
