import 'leaflet/dist/leaflet.css';
import './styles.css';
import { loadLandMask } from './area.js';
import { initUI } from './ui.js';

loadLandMask().catch(function () {
  console.warn('Land mask failed to load; water-only areas will match total until reload.');
});
initUI();
