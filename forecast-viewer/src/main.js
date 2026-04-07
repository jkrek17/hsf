import { loadLandMask } from './area.js';
import { initUI } from './ui.js';

loadLandMask().catch(function () {
  console.warn('Land mask failed to load; GeoJSON area_water_nm2 will match area_nm2 until reload.');
});
initUI();
