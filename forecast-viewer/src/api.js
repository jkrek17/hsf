const IEM_SEARCH = 'https://mesonet.agron.iastate.edu/json/nwstext_search.py';
const IEM_RETRIEVE = 'https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py';

const PIL_BY_OCEAN = {
  atlantic: 'HSFAT1',
  pacific: 'HSFEP1'
};

const OPC_PATH = {
  atlantic: '/shtml/NFDHSFAT1.txt',
  pacific: '/shtml/NFDHSFEP1.txt'
};

function opcBaseUrl() {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.DEV) {
    return '/opc';
  }
  return 'https://ocean.weather.gov';
}

/**
 * Fetch live High Seas Forecast text from OPC.
 * In Vite dev, uses proxy path /opc → ocean.weather.gov (CORS).
 * In production, calls OPC directly — browsers block cross-origin reads; deploy a same-origin proxy.
 */
export async function fetchLiveForecast(ocean) {
  const path = OPC_PATH[ocean] || OPC_PATH.atlantic;
  const url = opcBaseUrl() + path;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('OPC HTTP ' + res.status);
  return res.text();
}

function pilForOcean(ocean) {
  return PIL_BY_OCEAN[ocean] || PIL_BY_OCEAN.atlantic;
}

/** UTC day bounds for IEM search (sts inclusive, ets exclusive). */
function utcDayRangeIso(dateStr) {
  const sts = `${dateStr}T00:00:00Z`;
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const ets = `${y}-${m}-${day}T00:00:00Z`;
  return { sts, ets };
}

/**
 * List issuance timestamps (UTC ISO) for the given ocean PIL on a calendar date (YYYY-MM-DD, interpreted as UTC).
 */
export async function fetchArchiveList(ocean, dateStr) {
  const pil = pilForOcean(ocean);
  const { sts, ets } = utcDayRangeIso(dateStr);
  const url = `${IEM_SEARCH}?awipsid=${encodeURIComponent(pil)}&sts=${encodeURIComponent(sts)}&ets=${encodeURIComponent(ets)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('IEM list HTTP ' + res.status);
  const data = await res.json();
  const results = data.results || [];
  const stamps = results
    .map((r) => r.utcvalid)
    .filter(Boolean)
    .sort();
  return [...new Set(stamps)];
}

function stripHtmlWrapper(text) {
  if (!text || typeof text !== 'string') return '';
  var t = text.replace(/\r/g, '');
  var bodyMatch = t.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) t = bodyMatch[1];
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  return t.trim();
}

/**
 * Fetch a single archived product by issuance time (ISO string with Z, e.g. 2024-06-01T04:30:00Z).
 * Uses IEM retrieve.py with a 2-minute window around the stamp.
 */
export async function fetchArchiveProduct(ocean, timestampIso) {
  const pil = pilForOcean(ocean);
  const t = new Date(timestampIso);
  if (Number.isNaN(t.getTime())) throw new Error('Invalid archive timestamp');
  const start = new Date(t.getTime() - 60 * 1000);
  const end = new Date(t.getTime() + 60 * 1000);
  const sdate = start.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const edate = end.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const q = new URLSearchParams({
    pil,
    limit: '1',
    sdate,
    edate,
    fmt: 'text',
    order: 'asc'
  });
  const res = await fetch(`${IEM_RETRIEVE}?${q.toString()}`);
  if (!res.ok) throw new Error('IEM retrieve HTTP ' + res.status);
  const raw = await res.text();
  const cleaned = stripHtmlWrapper(raw);
  if (/^ERROR:/i.test(cleaned) || cleaned.indexOf('Could not Find') !== -1) {
    throw new Error(cleaned.split('\n')[0] || 'Archive product not found');
  }
  return cleaned;
}
