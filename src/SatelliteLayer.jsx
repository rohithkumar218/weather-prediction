import { TileLayer } from 'react-leaflet';

const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/all';
const LAYER = 'Himawari_AHI_Band13_Clean_Infrared_v0_NRT_ZENJPEG';
const EXT = 'jpeg'; // if tiles fail to load, try 'jpg' or 'png'
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export const SATELLITE_FRAME_COUNT = 12; // 12 frames x 10 min = last 2 hours
const SATELLITE_DELAY_MIN = 60;          // newest frame is ~1 hour old; reduce if tiles exist sooner
const STEP_MS = 10 * 60 * 1000;

export function buildSatelliteFrames(now = Date.now()) {
  const latest = Math.floor((now - SATELLITE_DELAY_MIN * 60 * 1000) / STEP_MS) * STEP_MS;
  return Array.from({ length: SATELLITE_FRAME_COUNT }, (_, i) =>
    new Date(latest - (SATELLITE_FRAME_COUNT - 1 - i) * STEP_MS));
}

const gibsTime = (date) => `${date.toISOString().slice(0, 19)}Z`;

export default function SatelliteLayer({ enabled, frame }) {
  if (!enabled || !frame) return null;
  return <>
    <TileLayer
      attribution='Satellite: Himawari via <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>'
      url={`${GIBS}/${LAYER}/default/${gibsTime(frame)}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.${EXT}`}
      maxNativeZoom={6}
      maxZoom={19}
      zIndex={250}
    />
    <TileLayer attribution='Labels &copy; Esri' url={LABELS} maxZoom={19} zIndex={260} />
  </>;
}
