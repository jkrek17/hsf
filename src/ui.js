import { fetchLiveForecast, fetchArchiveList, fetchArchiveProduct } from './api.js';
import { parseForecast, setForecastArea, getForecastArea } from './parser.js';
import {
  initMap,
  getMap,
  populateWarningDropdown,
  renderForecast,
  updateBoundary
} from './map.js';
import { computeAreas, computeWindPolygonAreas } from './area.js';
import { exportGeoJSON } from './geojson.js';

let currentForecast = null;
let currentFilter = 'all';
let currentWarning = 'all';
let currentOcean = 'atlantic';
let sourceMode = 'live'; // 'live' | 'archive' | 'paste'
let archiveTimestamps = [];
let archiveSelectedIso = null;

const layerVisibility = {
  hurricane: true,
  storm: true,
  gale: true,
  subgale: true,
  lows: true,
  spray: true,
  fog: true,
  boundary: true
};

let windAreaMetricsMap = new Map();

function utcTodayYmd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatArchiveFooter(iso) {
  if (!iso) return 'Archive';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Archive: ' + iso;
  return (
    'Archive: ' +
    d.getUTCFullYear() +
    '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getUTCDate()).padStart(2, '0') +
    ' ' +
    String(d.getUTCHours()).padStart(2, '0') +
    ':' +
    String(d.getUTCMinutes()).padStart(2, '0') +
    ' UTC'
  );
}

/** YYYY-MM-DD UTC calendar date plus delta whole days. */
function addUtcDays(ymd, deltaDays) {
  var parts = ymd.split('-');
  var y = parseInt(parts[0], 10);
  var mo = parseInt(parts[1], 10) - 1;
  var d = parseInt(parts[2], 10);
  var dt = new Date(Date.UTC(y, mo, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  var yy = dt.getUTCFullYear();
  var mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  var dd = String(dt.getUTCDate()).padStart(2, '0');
  return yy + '-' + mm + '-' + dd;
}

function populateIssuanceSelect(timestamps) {
  var select = document.getElementById('archive-issuance');
  select.innerHTML = '';
  for (var i = 0; i < timestamps.length; i++) {
    var iso = timestamps[i];
    var opt = document.createElement('option');
    opt.value = iso;
    opt.textContent = formatArchiveFooter(iso);
    select.appendChild(opt);
  }
}

function matchesWarningFilter(item, filter) {
  return filter === 'all' || item.warningBlock === filter;
}

function matchesFilter(item, filter) {
  if (filter === 'all') return true;
  if (filter === 'current') return !item.forecast || item.forecast === 'current';
  return item.forecast === filter + 'h';
}

function filteredWindAreasForStats() {
  if (!currentForecast) return [];
  let winds = currentForecast.windAreas.filter(function (i) {
    return matchesFilter(i, currentFilter);
  });
  if (currentWarning !== 'all') {
    winds = winds.filter(function (i) {
      return matchesWarningFilter(i, currentWarning);
    });
  }
  return winds;
}

function updateAreaStats() {
  var body = document.getElementById('area-stats-body');
  if (!body) return;

  var winds = filteredWindAreasForStats();
  var area = getForecastArea();
  var groups = computeAreas(winds, area);

  var rows = [
    { label: 'Gale', g: groups.GALE },
    { label: 'Storm', g: groups.STORM },
    { label: 'Hurricane', g: groups.HURRICANE }
  ];

  var html =
    '<table class="area-stats-table"><thead><tr><th>Type</th><th>Polygons</th><th>Area nm²</th></tr></thead><tbody>';
  var any = false;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.g.count === 0 && r.g.total_nm2 === 0) continue;
    any = true;
    html +=
      '<tr><td>' +
      r.label +
      '</td><td>' +
      r.g.count +
      '</td><td>' +
      r.g.total_nm2.toLocaleString(undefined, { maximumFractionDigits: 0 }) +
      '</td></tr>';
  }
  html += '</tbody></table>';
  if (!any) {
    body.innerHTML = '<p class="area-stats-empty">No gale, storm, or hurricane wind polygons for the current filters.</p>';
    return;
  }
  body.innerHTML = html;
}

function refreshWindAreaMetrics() {
  windAreaMetricsMap = new Map();
  if (!currentForecast) return;
  var winds = currentForecast.windAreas;
  var area = getForecastArea();
  var list = computeWindPolygonAreas(winds, area);
  for (var i = 0; i < list.length; i++) {
    windAreaMetricsMap.set(list[i].id, {
      area_nm2: list[i].area_nm2,
      area_water_nm2: list[i].area_water_nm2
    });
  }
}

function setForecastAreaLabel(ocean, area) {
  var areaLabel = document.getElementById('forecast-area-label');
  if (ocean === 'atlantic') {
    areaLabel.textContent = 'Clipped to ' + area.south + 'N-' + area.north + 'N, ' + Math.abs(area.east) + 'W-' + Math.abs(area.west) + 'W';
  } else {
    var wl = area.west <= 180 ? area.west + 'E' : 360 - area.west + 'W';
    var el = area.east <= 180 ? area.east + 'E' : 360 - area.east + 'W';
    areaLabel.textContent = 'Clipped to ' + area.south + 'N-' + area.north + 'N, ' + wl + '-' + el;
  }
}

function setValidTimeLine() {
  var el = document.getElementById('valid-time');
  if (!currentForecast) return;
  var valid = currentForecast.validTime ? 'Valid: ' + currentForecast.validTime : '';
  if (sourceMode === 'live') {
    el.textContent = valid ? 'Live · ' + valid : 'Live';
  } else if (sourceMode === 'archive') {
    el.textContent = (archiveSelectedIso ? formatArchiveFooter(archiveSelectedIso) + ' · ' : '') + (valid || 'Loaded');
  } else {
    el.textContent = (valid ? 'Manual · ' + valid : 'Manual parse');
  }
}

function redraw() {
  if (!currentForecast) return;
  renderForecast(currentForecast, currentFilter, currentWarning, layerVisibility, windAreaMetricsMap);
  updateAreaStats();
}

async function applyForecastText(text, ocean) {
  var area = setForecastArea(ocean);
  currentOcean = ocean;
  currentForecast = parseForecast(text);
  currentWarning = 'all';
  document.getElementById('warning-filter').value = 'all';

  var map = getMap();
  if (map) {
    map.setView(area.center, area.zoom);
  }
  updateBoundary(area, layerVisibility);
  setForecastAreaLabel(ocean, area);

  populateWarningDropdown(currentForecast);
  refreshWindAreaMetrics();
  redraw();
  setValidTimeLine();
}

async function loadOceanForecast(ocean) {
  var atlanticBtn = document.getElementById('btn-atlantic');
  var pacificBtn = document.getElementById('btn-pacific');
  atlanticBtn.classList.remove('active');
  pacificBtn.classList.remove('active');
  var activeBtn = ocean === 'atlantic' ? atlanticBtn : pacificBtn;
  activeBtn.classList.add('active', 'loading');
  sourceMode = 'live';
  archiveSelectedIso = null;
  document.getElementById('valid-time').textContent = 'Loading ' + ocean + ' forecast…';

  try {
    var text = await fetchLiveForecast(ocean);
    document.getElementById('forecast-input').value = text;
    await applyForecastText(text, ocean);
  } catch (err) {
    document.getElementById('valid-time').textContent = 'Error: ' + (err.message || err);
  } finally {
    activeBtn.classList.remove('loading');
  }
}

async function loadArchiveAt(iso) {
  if (!iso) return;
  var activeBtn = currentOcean === 'atlantic' ? document.getElementById('btn-atlantic') : document.getElementById('btn-pacific');
  activeBtn.classList.add('loading');
  document.getElementById('valid-time').textContent = 'Loading archive…';
  sourceMode = 'archive';
  archiveSelectedIso = iso;
  try {
    var text = await fetchArchiveProduct(currentOcean, iso);
    document.getElementById('forecast-input').value = text;
    await applyForecastText(text, currentOcean);
  } catch (err) {
    document.getElementById('valid-time').textContent = 'Error: ' + (err.message || err);
  } finally {
    activeBtn.classList.remove('loading');
  }
}

async function onArchiveDateChange() {
  var dateInput = document.getElementById('archive-date');
  var select = document.getElementById('archive-issuance');
  var ymd = dateInput.value;
  if (!ymd) {
    select.innerHTML = '<option value="">Select date first…</option>';
    archiveTimestamps = [];
    return;
  }
  select.innerHTML = '<option value="">Loading…</option>';
  try {
    archiveTimestamps = await fetchArchiveList(currentOcean, ymd);
    if (archiveTimestamps.length === 0) {
      select.innerHTML = '<option value="">No issuances found</option>';
      return;
    }
    populateIssuanceSelect(archiveTimestamps);
    select.value = archiveTimestamps[archiveTimestamps.length - 1];
    await loadArchiveAt(select.value);
  } catch (err) {
    select.innerHTML = '<option value="">Error loading list</option>';
    document.getElementById('valid-time').textContent = 'Archive list error: ' + (err.message || err);
  }
}

var ARCHIVE_DAY_SEARCH_MAX = 45;

/**
 * Step prev/next issuance; at day boundary load adjacent UTC calendar day
 * (first issuance when going forward, last when going back). Skips empty days.
 */
async function archiveNavigate(delta) {
  var dateInput = document.getElementById('archive-date');
  var select = document.getElementById('archive-issuance');
  var ymd = dateInput.value;
  if (!ymd) return;

  if (archiveTimestamps.length === 0) {
    await onArchiveDateChange();
    if (archiveTimestamps.length === 0) return;
  }

  var idx = select.selectedIndex;
  if (idx < 0) idx = 0;
  var ni = idx + delta;

  if (ni >= 0 && ni < select.options.length && select.options[ni].value) {
    select.selectedIndex = ni;
    await loadArchiveAt(select.value);
    return;
  }

  var dayStep = delta > 0 ? 1 : -1;
  var newYmd = addUtcDays(ymd, dayStep);
  var activeBtn = currentOcean === 'atlantic' ? document.getElementById('btn-atlantic') : document.getElementById('btn-pacific');
  activeBtn.classList.add('loading');
  document.getElementById('valid-time').textContent = 'Loading archive (next day)…';
  try {
    for (var h = 0; h < ARCHIVE_DAY_SEARCH_MAX; h++) {
      var stamps = await fetchArchiveList(currentOcean, newYmd);
      if (stamps.length > 0) {
        archiveTimestamps = stamps;
        dateInput.value = newYmd;
        populateIssuanceSelect(stamps);
        var pick = delta > 0 ? 0 : stamps.length - 1;
        select.selectedIndex = pick;
        await loadArchiveAt(stamps[pick]);
        return;
      }
      newYmd = addUtcDays(newYmd, dayStep);
    }
    document.getElementById('valid-time').textContent =
      'No archive issuances found within ' + ARCHIVE_DAY_SEARCH_MAX + ' days in that direction.';
  } catch (err) {
    document.getElementById('valid-time').textContent = 'Archive: ' + (err.message || err);
  } finally {
    activeBtn.classList.remove('loading');
  }
}

function initAboutModal() {
  var modal = document.getElementById('about-modal');
  var openBtn = document.getElementById('about-btn');
  if (!modal || !openBtn) return;

  function openModal() {
    modal.hidden = false;
    modal.removeAttribute('hidden');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var closeBtn = modal.querySelector('.modal-close');
    if (closeBtn) closeBtn.focus();
  }

  function closeModal() {
    modal.hidden = true;
    modal.setAttribute('hidden', '');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    openBtn.focus();
  }

  openBtn.addEventListener('click', function () {
    openModal();
  });

  modal.querySelectorAll('[data-close-modal]').forEach(function (el) {
    el.addEventListener('click', function () {
      closeModal();
    });
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });
}

export function initUI() {
  initMap();
  initAboutModal();

  var dateEl = document.getElementById('archive-date');
  if (dateEl && !dateEl.value) dateEl.value = utcTodayYmd();

  document.querySelectorAll('.tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (t) {
        t.classList.remove('active');
      });
      document.querySelectorAll('.tab-content').forEach(function (c) {
        c.classList.remove('active');
      });
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
  });

  document.querySelectorAll('.filter-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.filter-btn').forEach(function (b) {
        b.classList.remove('active');
      });
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      if (currentForecast) redraw();
    });
  });

  document.getElementById('warning-filter').addEventListener('change', function (e) {
    currentWarning = e.target.value;
    if (currentForecast) redraw();
  });

  document.querySelectorAll('.layer-toggle input[type="checkbox"]').forEach(function (cb) {
    cb.addEventListener('change', function () {
      layerVisibility[cb.dataset.layer] = cb.checked;
      if (currentForecast) redraw();
    });
  });

  document.getElementById('parse-btn').addEventListener('click', function () {
    var text = document.getElementById('forecast-input').value.trim();
    if (text) {
      sourceMode = 'paste';
      archiveSelectedIso = null;
      currentForecast = parseForecast(text);
      currentWarning = 'all';
      document.getElementById('warning-filter').value = 'all';
      populateWarningDropdown(currentForecast);
      refreshWindAreaMetrics();
      redraw();
      setValidTimeLine();
    }
  });

  document.getElementById('export-geojson-btn').addEventListener('click', function () {
    exportGeoJSON({
      forecast: currentForecast,
      ocean: currentOcean,
      filter: currentFilter,
      warningFilter: currentWarning,
      windAreaMetrics: windAreaMetricsMap
    });
  });

  document.getElementById('btn-atlantic').addEventListener('click', function () {
    loadOceanForecast('atlantic');
  });
  document.getElementById('btn-pacific').addEventListener('click', function () {
    loadOceanForecast('pacific');
  });

  document.getElementById('archive-date').addEventListener('change', function () {
    onArchiveDateChange();
  });
  document.getElementById('archive-issuance').addEventListener('change', function (e) {
    var v = e.target.value;
    if (v) loadArchiveAt(v);
  });
  document.getElementById('archive-prev').addEventListener('click', function () {
    archiveNavigate(-1).catch(function (err) {
      document.getElementById('valid-time').textContent = 'Archive: ' + (err.message || err);
    });
  });
  document.getElementById('archive-next').addEventListener('click', function () {
    archiveNavigate(1).catch(function (err) {
      document.getElementById('valid-time').textContent = 'Archive: ' + (err.message || err);
    });
  });
  document.getElementById('archive-live').addEventListener('click', function () {
    loadOceanForecast(currentOcean);
  });

  loadOceanForecast('atlantic');
}
