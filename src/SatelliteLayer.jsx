import { useEffect, useMemo, useRef, useState } from 'react';
import { TileLayer } from 'react-leaflet';

// NASA GIBS, Himawari infrared (covers India, Bay of Bengal, Asia-Pacific). No API key needed.
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/all';
const LAYER = 'Himawari_AHI_Band13_Clean_Infrared_v0_NRT_ZENJPEG';
const MATRIX = 'GoogleMapsCompatible_Level6';
const EXTENSIONS = ['jpeg', 'png', 'jpg']; // the first one that works is used automatically
const LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';

export const LOOP_OPTIONS = [3, 6, 12, 24]; // hours
const STEP_MS = 10 * 60 * 1000;             // one frame every 10 minutes
const PROBE_TILE = { z: 4, y: 7, x: 11 };   // a tile over India, used to find the newest frame
const MAX_DELAY_MIN = 150;

const gibsTime = (date) => `${new Date(date).toISOString().slice(0, 19)}Z`;
const tileUrl = (time, ext, z, y, x) =>
  `${GIBS}/${LAYER}/default/${gibsTime(time)}/${MATRIX}/${z}/${y}/${x}.${ext}`;

function hasContent(img) {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    for (let i = 4; i < d.length; i += 4) {
      if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return true;
    }
    return false; // a completely uniform tile means "no data for this time"
  } catch {
    return true;
  }
}

function probe(url, strict) {
  return new Promise((resolve) => {
    const img = new Image();
    if (strict) img.crossOrigin = 'anonymous';
    const timer = window.setTimeout(() => resolve(false), 10000);
    img.onload = () => {
      window.clearTimeout(timer);
      resolve(strict ? hasContent(img) : true);
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    img.src = url;
  });
}

// Finds the newest 10-minute frame that really exists, and which file extension the server uses.
async function detectLatest() {
  const base = Math.floor(Date.now() / STEP_MS) * STEP_MS;
  const times = [];
  for (let minutes = 10; minutes <= MAX_DELAY_MIN; minutes += 10) times.push(base - minutes * 60 * 1000);
  for (const strict of [true, false]) {
    for (const ext of EXTENSIONS) {
      const results = await Promise.all(times.map((time) =>
        probe(tileUrl(time, ext, PROBE_TILE.z, PROBE_TILE.y, PROBE_TILE.x), strict)));
      const found = results.findIndex(Boolean);
      if (found >= 0) return { time: times[found], ext };
    }
  }
  return null;
}

export function useSatelliteFrames(enabled, hours) {
  const [latest, setLatest] = useState(null);
  const [status, setStatus] = useState('');
  const hasData = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const run = async () => {
      if (!hasData.current) setStatus('Looking for the latest satellite image…');
      const found = await detectLatest();
      if (cancelled) return;
      if (found) {
        hasData.current = true;
        setStatus('');
        setLatest((previous) => (previous && previous.time === found.time && previous.ext === found.ext ? previous : found));
      } else if (!hasData.current) {
        setStatus('Satellite imagery is not available right now. Please try again later.');
      }
    };
    run();
    const intervalId = window.setInterval(run, 10 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [enabled]);

  const frames = useMemo(() => {
    if (!latest) return [];
    const count = hours * 6;
    return Array.from({ length: count }, (_, i) => new Date(latest.time - (count - 1 - i) * STEP_MS));
  }, [latest, hours]);

  return { frames, ext: latest?.ext ?? EXTENSIONS[0], status };
}

const urlFor = (date, ext) =>
  `${GIBS}/${LAYER}/default/${gibsTime(date)}/${MATRIX}/{z}/{y}/{x}.${ext}`;

export default function SatelliteLayer({ enabled, frames, index, ext, smooth }) {
  if (!enabled || frames.length === 0) return null;
  const safeIndex = Math.min(index, frames.length - 1);
  // Smooth mode keeps the next frames loaded (invisible) so playback does not flicker.
  const visible = smooth
    ? [safeIndex - 1, safeIndex, safeIndex + 1, safeIndex + 2].filter((i) => i >= 0 && i < frames.length)
    : [safeIndex];
  return <>
    {smooth
      ? visible.map((i) => <TileLayer
          key={`${frames[i].getTime()}-${ext}`}
          attribution='Satellite: Himawari via <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>'
          url={urlFor(frames[i], ext)}
          opacity={i === safeIndex ? 1 : 0}
          maxNativeZoom={6}
          maxZoom={19}
          zIndex={250}
        />)
      : <TileLayer
          key={`single-${ext}`}
          attribution='Satellite: Himawari via <a href="https://earthdata.nasa.gov/gibs">NASA GIBS</a>'
          url={urlFor(frames[safeIndex], ext)}
          maxNativeZoom={6}
          maxZoom={19}
          zIndex={250}
        />}
    <TileLayer attribution='Labels &copy; Esri' url={LABELS} maxZoom={19} zIndex={260} />
  </>;
}
