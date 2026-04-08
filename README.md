# Marine Weather Forecast Viewer

Interactive viewer for **NOAA Ocean Prediction Center (OPC) High Seas Forecast** text: it parses forecast bulletins, draws wind, fog, freezing spray, and low-pressure features on a **Leaflet** map, supports **live** and **archived** products, and can **export GeoJSON** with optional area metadata.

## Features

- **Live forecasts** from the National Weather Service **Products API** (`api.weather.gov`): High Seas product type **HSF**, locations **AT1** (Atlantic) and **EP1** (Pacific).
- **Archive** via the **Iowa Environmental Mesonet (IEM)** — pick a UTC date, choose an issuance, or step with **◀ / ▶** (automatically moves to the previous/next UTC day when you step past the first or last issuance that day).
- **Manual parse**: paste bulletin text and click **Parse Forecast**.
- **Map**: CartoDB Positron-style tiles, forecast-area boundary, layer toggles, hour and warning-block filters.
- **Side panel**: raw text, structured parse summary, **wind-area totals** (polygon nm² by gale / storm / hurricane, no land subtraction in the table).
- **Popups**: wind polygons show **water area** (nm²) where computed.
- **GeoJSON export**: filtered features with metadata; wind polygons include **`area_nm2`** (total) and **`area_water_nm2`** (after land mask), as integers.

## Run locally

Static files only — use any HTTP server (browsers need `http(s)://` for ES modules):

```bash
python3 serve.py
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/) (or serve the repo root with your own server).

## Project layout

| Path | Role |
|------|------|
| `index.html` | Shell, import map, script entry |
| `src/main.js` | Boot: land mask preload, UI init |
| `src/parser.js` | Bulletin parser (lat/lon boxes, sectors, lows, fog, spray, …) |
| `src/map.js` | Leaflet map, layers, popups, boundary |
| `src/ui.js` | Controls, live/archive/paste flows, filters |
| `src/api.js` | `api.weather.gov` + IEM HTTP clients |
| `src/area.js` | Turf area + land mask merge / difference |
| `src/geojson.js` | Export builder |
| `vendor/` | Vendored Leaflet and Turf (no npm, no CDN at runtime) |
| `public/land.geojson` | Natural Earth 110m land (for water-only area) |

## Area calculations

All polygon areas use **[Turf.js](https://turfjs.org/)** on **WGS 84** rings built from the parser’s `{ lat, lon }` bounds.

1. **Longitude for Turf / GeoJSON**  
   In the **Pacific** basin the parser may use longitudes **0–360°**. Before area or difference operations, longitudes **> 180°** are converted with **λ′ = λ − 360°** so coordinates stay in the usual **−180…180** range.

2. **Area in square meters**  
   **`turf.area(polygon)`** returns geodesic area in **m²** for that GeoJSON polygon.

3. **Square nautical miles**  
   One **nautical mile** = **1852 m** (international definition).  
   One **square nautical mile**:

   \[
   1\ \text{nm}^2 = 1852^2\ \text{m}^2 = 3{,}429{,}904\ \text{m}^2
   \]

   So:

   \[
   A_{\text{nm}^2} = \frac{A_{\text{m}^2}}{3{,}429{,}904}
   \]

   Values shown in the UI and in GeoJSON properties are **rounded to whole nm²** for display and export.

4. **Water-only area**  
   Land polygons from **`public/land.geojson`** (Natural Earth **1:110m** physical land) are merged into one multipolygon, then:

   \[
   \text{water polygon} = \text{difference}(\text{wind polygon},\ \text{land})
   \]

   **`turf.area(water polygon)`** gives **m²**, then the same **÷ 3,429,904** conversion. If the mask fails to load or geometry operations fail, water area **falls back** to total polygon area for that feature.

**Accuracy note:** The 110m land layer is **generalized**; near coasts, water-only nm² can differ from charting-grade results. Mid-ocean polygons are usually more stable.

## API notes

- **`api.weather.gov`** requires a descriptive **`User-Agent`** (the app sets one).
- **IEM** archive endpoints are used from the browser (CORS allowed).

## License

Map data © OpenStreetMap contributors, © CARTO. Forecast content is **NOAA** / public domain as applicable. Natural Earth land data: see [Natural Earth](https://www.naturalearthdata.com/) terms of use.
