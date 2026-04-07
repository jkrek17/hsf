const NWS_API = 'https://api.weather.gov';
const NWS_USER_AGENT = 'forecast-viewer (https://github.com/jkrek17/hsf; no reply expected)';

const IEM_SEARCH = 'https://mesonet.agron.iastate.edu/json/nwstext_search.py';
const IEM_RETRIEVE = 'https://mesonet.agron.iastate.edu/cgi-bin/afos/retrieve.py';

/** NWS Products API location codes for High Seas Forecast (HSF). */
const HSF_LOCATION = {
  atlantic: 'AT1',
  pacific: 'EP1'
};

const PIL_BY_OCEAN = {
  atlantic: 'HSFAT1',
  pacific: 'HSFEP1'
};

async function nwsJson(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': NWS_USER_AGENT,
      Accept: 'application/geo+json, application/json'
    }
  });
  if (!res.ok) throw new Error('NWS API HTTP ' + res.status);
  return res.json();
}

/**
 * Latest High Seas Forecast text from api.weather.gov (same product as OPC .txt).
 * https://api.weather.gov/products/types/HSF/locations/{AT1|EP1}
 */
export async function fetchLiveForecast(ocean) {
  const loc = HSF_LOCATION[ocean] || HSF_LOCATION.atlantic;
  const listUrl = `${NWS_API}/products/types/HSF/locations/${loc}`;
  const list = await nwsJson(listUrl);
  const graph = list['@graph'] || [];
  if (graph.length === 0) throw new Error('No HSF products returned for ' + loc);
  const productId = graph[0].id;
  if (!productId) throw new Error('Missing product id in NWS list response');
  const productUrl = `${NWS_API}/products/${productId}`;
  const product = await nwsJson(productUrl);
  var text = product.productText;
  if (text == null || text === '') throw new Error('Empty productText from NWS API');
  return typeof text === 'string' ? text : String(text);
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
