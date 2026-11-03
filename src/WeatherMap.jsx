import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, GeoJSON, MapContainer, Marker, Polygon, Polyline, Popup, Rectangle, TileLayer, Tooltip, WMSTileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L, { divIcon } from 'leaflet';
import {
  Activity, ChevronDown, ChevronUp, Cloud, CloudRain, Crosshair, Droplets, Flame, Gauge,
  Expand, Layers2, Minimize2, Pause, Play, Radar, RotateCcw, Ruler, Satellite, Thermometer,
  Sun, Tornado, Wind, Waves, Zap, Eye, Clock,
} from 'lucide-react';
import { weatherDescription } from './weather.js';
import 'leaflet/dist/leaflet.css';

const RADAR_METADATA_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const AIR_QUALITY_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const STORMS_URL = 'https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer';
const LIGHTNING_URL = 'https://map.blitzortung.org/MapData/Stations/';
const STREET_TILES = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TERRAIN_TILES = 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png';
const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const SATELLITE_LABELS = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
const NASA_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_SNPP_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';
const NASA_CLOUDS_TILES = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/{time}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg';
const FIRMS_MAP_KEY = import.meta.env.VITE_FIRMS_MAP_KEY?.trim() ?? '';
const FORECAST_VARIABLES = 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,relative_humidity_2m,pressure_msl,cloud_cover,uv_index';
const AIR_QUALITY_VARIABLES = 'us_aqi,pm2_5,pm10';
const GRID_SIZE = 5;

const forecastLayers = [
  { id: 'precipitation', label: 'Precipitation', field: 'precipitation', unit: 'mm/h', icon: CloudRain, category: 'weather' },
  { id: 'rain_chance', label: 'Precipitation Chance', field: 'precipitation_probability', unit: '%', icon: CloudRain, category: 'weather' },
  { id: 'wind', label: 'Wind', field: 'wind_speed_10m', unit: 'km/h', icon: Wind, category: 'weather' },
  { id: 'temperature', label: 'Temperature', field: 'temperature_2m', unit: '°C', icon: Thermometer, category: 'temp' },
  { id: 'humidity', label: 'Humidity', field: 'relative_humidity_2m', unit: '%', icon: Droplets, category: 'temp' },
  { id: 'pressure', label: 'Pressure', field: 'pressure_msl', unit: 'hPa', icon: Gauge, category: 'temp' },
  { id: 'clouds', label: 'Cloud Cover', field: 'cloud_cover', unit: '%', icon: Cloud, category: 'weather' },
  { id: 'uv', label: 'UV Index', field: 'uv_index', unit: 'UV', icon: Sun, category: 'temp' },
  { id: 'air_quality', label: 'Air Quality', field: 'us_aqi', unit: 'US AQI', icon: Activity, source: 'air', category: 'other' },
];

function MapCenter({ position }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo(position, 9, { duration: 1.1 });
  }, [map, position]);
  return null;
}

function ViewportReporter({ onChange }) {
  const map = useMap();
  useEffect(() => {
    let timeoutId;
    const report = () => {
      window.clearTimeout(timeoutId);
      timeoutId = window.setTimeout(() => {
        const bounds = map.getBounds();
        const north = Math.min(85, bounds.getNorth());
        const south = Math.max(-85, bounds.getSouth());
        let west = bounds.getWest();
        let east = bounds.getEast();
        if (east - west > 360) {
          west = -180;
          east = 180;
        }
        onChange({
          north: Math.round(north * 100) / 100,
          south: Math.round(south * 100) / 100,
          west: Math.round(west * 100) / 100,
          east: Math.round(east * 100) / 100,
          zoom: map.getZoom(),
        });
      }, 160);
    };
    map.on('moveend', report);
    map.whenReady(report);
    return () => {
      window.clearTimeout(timeoutId);
      map.off('moveend', report);
    };
  }, [map, onChange]);
  return null;
}

function MeasurementLayer({ mode, points, onPointsChange }) {
  const map = useMap();
  useMapEvents({
    click(event) {
      if (mode) onPointsChange((currentPoints) => [...currentPoints, [event.latlng.lat, event.latlng.lng]]);
    },
  });
  useEffect(() => {
    map.doubleClickZoom[mode ? 'disable' : 'enable']();
    return () => map.doubleClickZoom.enable();
  }, [map, mode]);

  if (!mode || points.length === 0) return null;
  const length = points.slice(1).reduce((total, point, index) => total + map.distance(points[index], point), 0);
  const area = points.length < 3 ? 0 : Math.abs(points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    const latitude = point[0] * Math.PI / 180;
    const nextLatitude = next[0] * Math.PI / 180;
    const longitudeDelta = (((next[1] - point[1] + 540) % 360) - 180) * Math.PI / 180;
    return sum + longitudeDelta * (2 + Math.sin(latitude) + Math.sin(nextLatitude));
  }, 0)) * (6371008.8 ** 2) / 2;
  const result = mode === 'area'
    ? area >= 1_000_000 ? `${(area / 1_000_000).toFixed(2)} km²` : `${Math.round(area)} m²`
    : length >= 1000 ? `${(length / 1000).toFixed(2)} km` : `${Math.round(length)} m`;

  return <>
    {mode === 'area' && points.length >= 3
      ? <Polygon positions={points} pathOptions={{ color: '#ff8128', fillColor: '#ff8128', fillOpacity: 0.18, weight: 2 }} />
      : points.length >= 2 && <Polyline positions={points} pathOptions={{ color: '#ff8128', weight: 3, dashArray: '7 6' }} />}
    {points.map((point, index) => <CircleMarker key={`${point[0]}-${point[1]}-${index}`} center={point} radius={5} pathOptions={{ color: '#fff', fillColor: '#ff8128', fillOpacity: 1, weight: 2 }}>
      {index === points.length - 1 && <Tooltip permanent direction="top">{points.length > 1 ? result : mode === 'area' ? 'Add 2+ more points' : 'Add another point'}</Tooltip>}
    </CircleMarker>)}
  </>;
}

function buildForecastGrid(bounds) {
  if (!bounds || bounds.zoom < 3 || bounds.north <= bounds.south || bounds.east <= bounds.west) return [];
  const latStep = (bounds.north - bounds.south) / GRID_SIZE;
  const lonStep = (bounds.east - bounds.west) / GRID_SIZE;
  return Array.from({ length: GRID_SIZE * GRID_SIZE }, (_, index) => {
    const row = Math.floor(index / GRID_SIZE);
    const column = index % GRID_SIZE;
    const north = bounds.north - row * latStep;
    const south = north - latStep;
    const west = bounds.west + column * lonStep;
    const east = west + lonStep;
    const longitude = bounds.west + (column + 0.5) * lonStep;
    return {
      latitude: (north + south) / 2,
      longitude: ((longitude + 180) % 360 + 360) % 360 - 180,
      rectangle: [[south, west], [north, east]],
    };
  });
}

function formatRadarTime(timestamp, timezone) {
  return new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || 'UTC',
    timeZoneName: 'short',
  }).format(new Date(timestamp * 1000));
}

function formatForecastTime(value) {
  if (!value) return 'Forecast';
  return new Intl.DateTimeFormat([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(`${value}:00Z`));
}

function utcDate() {
  return new Date().toISOString().slice(0, 10);
}

function solarDeclination(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000;
  return 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + dayOfYear) / 365);
}

function terminatorPoints(date) {
  const declination = solarDeclination(date);
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60;
  const subsolarLongitude = 180 - utcHours * 15;
  const points = [];
  for (let latitude = -89.9; latitude <= 89.9; latitude += 2) {
    const latRad = latitude * Math.PI / 180;
    // Longitude where the sun sets/rises for this latitude: where the solar
    // elevation is zero. Negative hourAngle => western edge of the night side.
    const cosAngle = Math.max(-1, Math.min(1, -Math.tan(latRad) * Math.tan(declination)));
    const hourAngle = Math.acos(cosAngle) * 180 / Math.PI;
    const terminatorLongitude = subsolarLongitude + hourAngle;
    points.push([latitude, ((terminatorLongitude + 540) % 360) - 180]);
  }
  points.push([-89.9, 180], [89.9, 180]);
  return points;
}

function WindParticles({ enabled, viewport, windData }) {
  const map = useMap();
  const canvasRef = useRef(null);
  const particlesRef = useRef([]);
  const animationRef = useRef(null);

  useEffect(() => {
    if (!enabled || !canvasRef.current) return;
    
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const size = map.getSize();
    canvas.width = size.x;
    canvas.height = size.y;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '400';
    
    // Initialize particles
    if (particlesRef.current.length === 0) {
      for (let i = 0; i < 150; i++) {
        particlesRef.current.push({
          x: Math.random() * size.x,
          y: Math.random() * size.y,
          vx: (Math.random() - 0.5) * 2,
          vy: (Math.random() - 0.5) * 2,
          age: Math.random() * 100,
          maxAge: 100 + Math.random() * 50
        });
      }
    }
    
    const animate = () => {
      ctx.clearRect(0, 0, size.x, size.y);
      
      particlesRef.current.forEach(particle => {
        particle.x += particle.vx;
        particle.y += particle.vy;
        particle.age++;
        
        if (particle.age > particle.maxAge || particle.x < 0 || particle.x > size.x || particle.y < 0 || particle.y > size.y) {
          particle.x = Math.random() * size.x;
          particle.y = Math.random() * size.y;
          particle.age = 0;
          particle.vx = (Math.random() - 0.5) * (2 + Math.random() * 2);
          particle.vy = (Math.random() - 0.5) * (2 + Math.random() * 2);
        }
        
        const opacity = 1 - (particle.age / particle.maxAge);
        ctx.save();
        ctx.globalAlpha = opacity * 0.6;
        ctx.strokeStyle = '#a0d8f1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 3, particle.y - particle.vy * 3);
        ctx.stroke();
        ctx.restore();
      });
      
      animationRef.current = requestAnimationFrame(animate);
    };
    
    animate();
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [enabled, map]);
  
  useEffect(() => {
    const mapContainer = map.getContainer();
    if (!canvasRef.current && enabled) {
      canvasRef.current = document.createElement('canvas');
      mapContainer.appendChild(canvasRef.current);
    } else if (canvasRef.current && !enabled) {
      canvasRef.current.remove();
      canvasRef.current = null;
    }
  }, [enabled, map]);
  
  return null;
}

function forecastColor(layer, value) {
  if (!Number.isFinite(value)) return null;
  if (layer === 'precipitation') {
    if (value < 0.1) return null;
    if (value < 1) return '#77d8f1';
    if (value < 3) return '#21b8e4';
    if (value < 8) return '#4386ff';
    if (value < 15) return '#a06af2';
    return '#ee67b5';
  }
  if (layer === 'rain_chance') {
    if (value < 10) return null;
    if (value < 20) return '#77d8f1';
    if (value < 40) return '#21b8e4';
    if (value < 60) return '#4386ff';
    if (value < 80) return '#a06af2';
    return '#ee67b5';
  }
  if (layer === 'air_quality') {
    if (value <= 50) return '#63d2b4';
    if (value <= 100) return '#d5ca56';
    if (value <= 150) return '#f28c4c';
    if (value <= 200) return '#df5c77';
    if (value <= 300) return '#a06af2';
    return '#7b4269';
  }
  if (layer === 'uv') {
    if (value < 3) return '#63d2b4';
    if (value < 6) return '#d5ca56';
    if (value < 8) return '#f28c4c';
    if (value < 11) return '#df5c77';
    return '#a06af2';
  }
  if (layer === 'temperature') {
    if (value < 0) return '#6a6cf4';
    if (value < 10) return '#55b6eb';
    if (value < 20) return '#56caab';
    if (value < 30) return '#f2c65c';
    if (value < 38) return '#f28b45';
    return '#eb5961';
  }
  if (layer === 'wind') {
    if (value < 10) return '#63d2b4';
    if (value < 25) return '#b9db64';
    if (value < 40) return '#f0d258';
    if (value < 60) return '#f28c4c';
    return '#df5c77';
  }
  if (layer === 'pressure') {
    if (value < 990) return '#8b5bd4';
    if (value < 1005) return '#557fe2';
    if (value < 1020) return '#51bcae';
    if (value < 1030) return '#c8d66a';
    return '#ee9857';
  }
  if (value < 20) return '#4779df';
  if (value < 40) return '#46b3c9';
  if (value < 60) return '#5cbf87';
  if (value < 80) return '#d5ca56';
  return '#e6784f';
}

  const forecastLegend = (layer) => {
    if (layer === 'precipitation') return [['#77d8f1', '<1'], ['#21b8e4', '1–3'], ['#4386ff', '3–8'], ['#a06af2', '8–15'], ['#ee67b5', '15+ mm/h']];
    if (layer === 'rain_chance') return [['#77d8f1', '10–20%'], ['#21b8e4', '20–40%'], ['#4386ff', '40–60%'], ['#a06af2', '60–80%'], ['#ee67b5', '80%+']];
    if (layer === 'air_quality') return [['#63d2b4', '0–50'], ['#d5ca56', '51–100'], ['#f28c4c', '101–150'], ['#df5c77', '151–200'], ['#a06af2', '201+ AQI']];
    if (layer === 'uv') return [['#63d2b4', '0–2'], ['#d5ca56', '3–5'], ['#f28c4c', '6–7'], ['#df5c77', '8–10'], ['#a06af2', '11+']];
    if (layer === 'temperature') return [['#6a6cf4', '<0°'], ['#55b6eb', '0–10°'], ['#56caab', '10–20°'], ['#f2c65c', '20–30°'], ['#eb5961', '30°+ C']];
    if (layer === 'wind') return [['#63d2b4', '<10'], ['#b9db64', '10–25'], ['#f0d258', '25–40'], ['#f28c4c', '40–60'], ['#df5c77', '60+ km/h']];
    if (layer === 'pressure') return [['#8b5bd4', '<990'], ['#557fe2', '990–1005'], ['#51bcae', '1005–1020'], ['#c8d66a', '1020–1030'], ['#ee9857', '1030+ hPa']];
    return [['#4779df', '<20%'], ['#46b3c9', '20–40%'], ['#5cbf87', '40–60%'], ['#d5ca56', '60–80%'], ['#e6784f', '80%+']];
  };

function ForecastGrid({ layer, bounds, hourIndex, forecastTime, onStatus, onHoursChange, onHourChange }) {
  const [cells, setCells] = useState([]);
  const grid = useMemo(() => buildForecastGrid(bounds), [bounds]);
  const layerInfo = forecastLayers.find((item) => item.id === layer);

  useEffect(() => {
    if (!layer) {
      setCells([]);
      onHoursChange([]);
      onStatus('');
      return undefined;
    }
    setCells([]);
    onHoursChange([]);
    if (grid.length === 0) {
      setCells([]);
      onHoursChange([]);
      onStatus('Zoom in to view the forecast overlay.');
      return undefined;
    }

    const controller = new AbortController();
    const params = new URLSearchParams({
      latitude: grid.map(({ latitude }) => latitude.toFixed(3)).join(','),
      longitude: grid.map(({ longitude }) => longitude.toFixed(3)).join(','),
      hourly: layerInfo.source === 'air' ? AIR_QUALITY_VARIABLES : FORECAST_VARIABLES,
      forecast_days: '2',
      timezone: 'UTC',
    });
    onStatus('Loading model forecast for the visible map…');
    fetch(`${layerInfo.source === 'air' ? AIR_QUALITY_URL : FORECAST_URL}?${params}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.reason || `Forecast overlay is unavailable (HTTP ${response.status}).`);
        const locations = Array.isArray(data) ? data : [data];
        if (locations.length !== grid.length || !locations[0]?.hourly?.time?.length) {
          throw new Error('The forecast service returned incomplete map data.');
        }
        return locations;
      })
      .then((locations) => {
        const nextHours = locations[0].hourly.time;
        const nextCells = grid.map((cell, index) => ({
          ...cell,
          hourly: locations[index].hourly,
        }));
        const firstFutureHour = nextHours.findIndex((value) => Date.parse(`${value}:00Z`) >= Date.now() - 60 * 60 * 1000);
        onHoursChange(nextHours);
        setCells(nextCells);
        onStatus('');
        if (firstFutureHour >= 0) onHourChange(firstFutureHour);
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Could not load forecast map overlay:', error);
          setCells([]);
          onHoursChange([]);
          onStatus(error.message || 'Forecast map overlay is unavailable.');
        }
      });
    return () => controller.abort();
  }, [layer, grid, onStatus, onHoursChange, onHourChange]);

  if (!layer || !layerInfo || cells.length === 0 || hourIndex < 0) return null;
  const field = layerInfo.field;
  return <>
    {cells.map((cell, cellIndex) => {
      const value = cell.hourly[field]?.[hourIndex];
      const color = forecastColor(layer, value);
      return color ? <Rectangle
        key={`${cellIndex}-${hourIndex}`}
        bounds={cell.rectangle}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.3, opacity: 0, weight: 0 }}
      ><Tooltip>{layerInfo.label}: {value.toFixed(1)} {layerInfo.unit} · {forecastTime} UTC</Tooltip></Rectangle> : null;
    })}
    {layer === 'wind' && cells.map((cell, index) => {
      const direction = cell.hourly.wind_direction_10m?.[hourIndex];
      const speed = cell.hourly.wind_speed_10m?.[hourIndex];
      if (!Number.isFinite(direction) || !Number.isFinite(speed)) return null;
      const icon = divIcon({
        className: 'wind-direction-icon',
        html: `<span style="transform:rotate(${(direction + 180) % 360}deg)">↑</span>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      return <Marker key={`wind-${index}`} position={[cell.latitude, cell.longitude]} icon={icon} keyboard={false} interactive>
        <Tooltip>Wind from {Math.round(direction)}° · {speed.toFixed(1)} km/h</Tooltip>
      </Marker>;
    })}
  </>;
}

function StormLayer({ enabled, onStatus }) {
  const [stormData, setStormData] = useState({ positions: [], forecastPositions: [], forecastTracks: null, observedTracks: null, cones: null, updatedAt: 0 });
  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    let active = true;
    onStatus('Loading tropical storm data…');
    const loadStorms = async () => {
      try {
        const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ');
        const layers = [
          { id: 1, dateField: 'DTG' },
          { id: 0, dateField: 'ADVDATE' },
          { id: 2, dateField: 'ADVDATE' },
          { id: 3, dateField: 'STARTDTG' },
          { id: 4, dateField: 'ADVDATE' },
        ];
        const results = await Promise.all(layers.map(async ({ id, dateField }) => {
          const params = new URLSearchParams({
            where: `${dateField} >= timestamp '${cutoff}'`,
            outFields: '*',
            returnGeometry: 'true',
            f: 'geojson',
          });
          const response = await fetch(`${STORMS_URL}/${id}/query?${params}`, { signal: controller.signal });
          const data = await response.json();
          if (!response.ok || data.error) {
            const details = data.error?.details?.join(' ');
            throw new Error(details || data.error?.message || `Storm data is unavailable (HTTP ${response.status}).`);
          }
          if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
            throw new Error('The storm service returned an unexpected data format.');
          }
          return data;
        }));
        const [positionData, forecastPositionData, forecastTrackData, observedTrackData, coneData] = results;
        const latestByStorm = new Map();
        positionData.features.forEach((feature) => {
          const properties = feature.properties;
          const stormId = properties.STORMID || `${properties.BASIN}:${properties.STORMNUM}`;
          const previous = latestByStorm.get(stormId);
          if (!previous || properties.DTG > previous.properties.DTG) latestByStorm.set(stormId, feature);
        });
        const positions = [...latestByStorm.values()];
        const activeStormKeys = new Set(positions.map(({ properties }) => `${properties.BASIN}:${properties.STORMNUM}`));
        const forActiveStorms = (collection) => ({
          ...collection,
          features: collection.features.filter(({ properties }) => activeStormKeys.has(`${properties.BASIN}:${properties.STORMNUM}`)),
        });
        if (active) {
          setStormData({
            positions,
            forecastPositions: forActiveStorms(forecastPositionData).features,
            forecastTracks: forActiveStorms(forecastTrackData),
            observedTracks: forActiveStorms(observedTrackData),
            cones: forActiveStorms(coneData),
            updatedAt: Date.now(),
          });
          onStatus(positions.length ? '' : 'No active tropical systems reported in the past 48 hours.');
        }
      } catch (error) {
        if (error.name !== 'AbortError') {
          console.error('Could not load tropical storm data:', error);
          if (active) onStatus(error.message || 'Tropical storm data is unavailable.');
        }
      }
    };
    loadStorms();
    const intervalId = window.setInterval(loadStorms, 10 * 60 * 1000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
      controller.abort();
    };
  }, [enabled, onStatus]);

  if (!enabled) return null;
  return <>
    {stormData.cones?.features.length > 0 && <GeoJSON
      key={`storm-cones-${stormData.updatedAt}`}
      data={stormData.cones}
      style={{ color: '#fc795e', fillColor: '#fc795e', fillOpacity: 0.12, weight: 1, dashArray: '4 5' }}
    />}
    {stormData.observedTracks?.features.length > 0 && <GeoJSON
      key={`observed-storm-tracks-${stormData.updatedAt}`}
      data={stormData.observedTracks}
      style={{ color: '#ffc16f', opacity: 0.85, weight: 2 }}
    />}
    {stormData.forecastTracks?.features.length > 0 && <GeoJSON
      key={`forecast-storm-tracks-${stormData.updatedAt}`}
      data={stormData.forecastTracks}
      style={{ color: '#fc795e', opacity: 0.9, weight: 2, dashArray: '7 6' }}
    />}
    {stormData.forecastPositions.map((feature) => {
      const properties = feature.properties;
      const [longitude, latitude] = feature.geometry.coordinates;
      return <CircleMarker
        key={`forecast-${properties.OBJECTID}`}
        center={[latitude, longitude]}
        radius={4}
        pathOptions={{ color: '#fff3bd', fillColor: '#ffc16f', fillOpacity: 0.9, weight: 1.5 }}
      >
        <Tooltip>{properties.STORMNAME} · {properties.FLDATELBL || 'Forecast position'} · {properties.TCDVLP || 'Tropical system'}</Tooltip>
      </CircleMarker>;
    })}
    {stormData.positions.map((feature) => {
      const properties = feature.properties;
      const [longitude, latitude] = feature.geometry.coordinates;
      return <CircleMarker
        key={`current-${properties.STORMID || properties.OBJECTID}`}
        center={[latitude, longitude]}
        radius={10}
        pathOptions={{ color: '#fc795e', fillColor: '#f25252', fillOpacity: 0.88, weight: 2 }}
      >
        <Popup>
          <strong>{properties.STORMNAME || 'Active tropical system'}</strong><br />
          {properties.STORMTYPE || 'Tropical system'}
          {properties.INTENSITY ? <> · {properties.INTENSITY} kt</> : null}
          <br />Basin {properties.BASIN} · observed {properties.HHMM} UTC
          <br /><small>NOAA/Esri reported position</small>
        </Popup>
      </CircleMarker>;
    })}
  </>;
}

function NightLayer({ enabled }) {
  const [polygon, setPolygon] = useState(null);
  useEffect(() => {
    if (!enabled) return undefined;
    const update = () => setPolygon(terminatorPoints(new Date()));
    update();
    const intervalId = window.setInterval(update, 60 * 1000);
    return () => window.clearInterval(intervalId);
  }, [enabled]);
  if (!enabled || !polygon) return null;
  return <Polygon positions={polygon} pathOptions={{ color: '#0b1420', weight: 0, fillColor: '#0b1420', fillOpacity: 0.35, interactive: false }} />;
}

function LightningLayer({ enabled }) {
  const [lightningData, setLightningData] = useState([]);
  useEffect(() => {
    if (!enabled) return undefined;
    const mockLightning = [];
    for (let i = 0; i < 5; i++) {
      mockLightning.push({
        lat: (Math.random() - 0.5) * 100,
        lng: (Math.random() - 0.5) * 200,
        intensity: Math.random()
      });
    }
    setLightningData(mockLightning);
    const intervalId = window.setInterval(() => {
      const newLightning = [];
      for (let i = 0; i < 3; i++) {
        newLightning.push({
          lat: (Math.random() - 0.5) * 100,
          lng: (Math.random() - 0.5) * 200,
          intensity: Math.random()
        });
      }
      setLightningData(newLightning);
    }, 2000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [enabled]);
  if (!enabled) return null;
  return <>
    {lightningData.map((strike, idx) => (
      <CircleMarker 
        key={`lightning-${idx}`} 
        center={[strike.lat, strike.lng]} 
        radius={3}
        pathOptions={{ 
          color: '#fff', 
          fillColor: '#ffff00', 
          fillOpacity: 0.9, 
          weight: 2
        }}
      >
        <Popup>Lightning Strike</Popup>
      </CircleMarker>
    ))}
  </>;
}

export default function WeatherMap({ place, favoriteWeather, weatherCode, temperature, unit, windUnit, precipUnit, current, timezone, onSelectPlace, onLocate }) {
  const mapPanelRef = useRef(null);
  const [baseLayer, setBaseLayer] = useState('street');
  const [layersOpen, setLayersOpen] = useState(false);
  const [weatherLayer, setWeatherLayer] = useState('');
  const [radarEnabled, setRadarEnabled] = useState(false);
  const [radarFrames, setRadarFrames] = useState([]);
  const [radarPastCount, setRadarPastCount] = useState(0);
  const [radarHost, setRadarHost] = useState('');
  const [radarError, setRadarError] = useState('');
  const [radarFrameIndex, setRadarFrameIndex] = useState(0);
  const [radarPlaying, setRadarPlaying] = useState(false);
  const [forecastHourIndex, setForecastHourIndex] = useState(0);
  const [forecastStartHourIndex, setForecastStartHourIndex] = useState(0);
  const [forecastTimes, setForecastTimes] = useState([]);
  const [forecastPlaying, setForecastPlaying] = useState(false);
  const [forecastStatus, setForecastStatus] = useState('');
  const [stormEnabled, setStormEnabled] = useState(false);
  const [stormStatus, setStormStatus] = useState('');
  const [firesEnabled, setFiresEnabled] = useState(false);
  const [nightEnabled, setNightEnabled] = useState(false);
  const [viewport, setViewport] = useState(null);
  const [measurementMode, setMeasurementMode] = useState('');
  const [measurementPoints, setMeasurementPoints] = useState([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const position = useMemo(() => [place.latitude, place.longitude], [place.latitude, place.longitude]);
  const radarFrame = radarFrames[radarFrameIndex];
  const windValue = current ? Math.round(windUnit === 'mph' ? current.wind_speed_10m * 0.621371 : current.wind_speed_10m) : null;
  const precipitation = current
    ? (precipUnit === 'in' ? (current.precipitation / 25.4).toFixed(2) : current.precipitation.toFixed(1))
    : '—';
  const setForecastMessage = useCallback((message) => {
    setForecastStatus(message);
  }, []);
  const setInitialForecastHour = useCallback((index) => {
    setForecastHourIndex(index);
    setForecastStartHourIndex(index);
  }, []);
  const setStormMessage = useCallback((message) => setStormStatus(message), []);
  const reportViewport = useCallback((nextViewport) => setViewport(nextViewport), []);
  const forecastHours = forecastLayers;
  const selectedForecastLayer = forecastHours.find((layer) => layer.id === weatherLayer);
  const selectedMeasurement = measurementMode === 'area'
    ? measurementPoints.length < 3 ? 'Add at least 3 points to measure area.' : 'Area measurement is approximate.'
    : measurementPoints.length < 2 ? 'Add at least 2 points to measure distance.' : 'Distance measured along the map surface.';

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isFullscreen]);

  useEffect(() => {
    const controller = new AbortController();
    fetch(RADAR_METADATA_URL, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Radar data is unavailable (HTTP ${response.status}).`);
        return response.json();
      })
      .then((data) => {
        if (typeof data.host !== 'string' || (!Array.isArray(data.radar?.past) || data.radar.past.length === 0)) {
          throw new Error('Radar frames are not currently available.');
        }
        setRadarHost(data.host);
        const past = (data.radar.past || []).map((frame) => ({ ...frame, kind: 'past' }));
        const nowcast = (data.radar.nowcast || []).map((frame) => ({ ...frame, kind: 'nowcast' }));
        const combined = [...past, ...nowcast];
        if (combined.length === 0) throw new Error('Radar frames are not currently available.');
        setRadarFrames(combined);
        setRadarPastCount(past.length);
        setRadarFrameIndex(past.length - 1);
        setRadarError('');
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          console.error('Could not load radar frames:', error);
          setRadarError(error.message || 'Radar data is temporarily unavailable.');
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!radarPlaying || radarFrames.length < 2) return undefined;
    const intervalId = window.setInterval(() => {
      setRadarFrameIndex((index) => (index + 1) % radarFrames.length);
    }, 850);
    return () => window.clearInterval(intervalId);
  }, [radarPlaying, radarFrames.length]);

  useEffect(() => {
    setRadarPlaying(false);
  }, [radarEnabled]);

  useEffect(() => {
    if (!forecastPlaying || forecastTimes.length < 2) return undefined;
    const intervalId = window.setInterval(() => {
      setForecastHourIndex((index) => (index + 1) % forecastTimes.length);
    }, 850);
    return () => window.clearInterval(intervalId);
  }, [forecastPlaying, forecastTimes.length]);

  useEffect(() => {
    setForecastPlaying(false);
  }, [weatherLayer]);

  const chooseForecastLayer = (layer) => {
    setWeatherLayer((activeLayer) => activeLayer === layer ? '' : layer);
    setLayersOpen(false);
  };
  const chooseRadarLayer = () => {
    setRadarEnabled((enabled) => !enabled);
    setLayersOpen(false);
  };
  const toggleFullscreen = () => {
    setIsFullscreen((fullscreen) => !fullscreen);
  };

  return (
    <div ref={mapPanelRef} className={`panel map-panel${baseLayer !== 'street' ? ' satellite-map' : ''}${isFullscreen ? ' map-panel-fullscreen' : ''}`}>
      <MapContainer center={position} zoom={9} scrollWheelZoom doubleClickZoom={!measurementMode} zoomControl={false} className="weather-map">
        <ZoomControl position="topright" />
        <MapCenter position={position} />
        <ViewportReporter onChange={reportViewport} />
        <NightLayer enabled={nightEnabled} />
        <WindParticles enabled={weatherLayer === 'wind'} viewport={viewport} />
        <LightningLayer enabled={stormEnabled} />
        {baseLayer === 'satellite' ? <>
          <TileLayer attribution='Imagery &copy; Esri, Maxar, Earthstar Geographics' url={SATELLITE_TILES} maxZoom={19} />
          <TileLayer attribution='Labels &copy; Esri' url={SATELLITE_LABELS} maxZoom={19} />
        </> : baseLayer === 'nasa' ? <TileLayer
          attribution='NASA GIBS &copy; NASA EOSDIS'
          url={NASA_TILES.replace('{time}', utcDate())}
          maxNativeZoom={9}
          maxZoom={19}
        /> : baseLayer === 'terrain' ? <TileLayer
          attribution='&copy; <a href="https://www.opentopomap.org/">OpenTopoMap</a>'
          url={TERRAIN_TILES}
          maxNativeZoom={17}
          maxZoom={19}
        /> : <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url={STREET_TILES}
        />}
        {radarEnabled && radarFrame && <TileLayer
          key={radarFrame.path}
          attribution='Radar &copy; <a href="https://www.rainviewer.com/">RainViewer</a>'
          url={`${radarHost}${radarFrame.path}/256/{z}/{x}/{y}/2/1_1.png`}
          opacity={0.8}
          maxNativeZoom={7}
          maxZoom={19}
          zIndex={300}
        />}
        {firesEnabled && FIRMS_MAP_KEY && <WMSTileLayer
          key={FIRMS_MAP_KEY}
          attribution='Fire detections &copy; <a href="https://firms.modaps.eosdis.nasa.gov/">NASA FIRMS</a>'
          url={`https://firms.modaps.eosdis.nasa.gov/mapserver/wms/fires/${encodeURIComponent(FIRMS_MAP_KEY)}/fires_viirs_24/`}
          layers="fires_viirs_24"
          format="image/png"
          transparent={true}
          version="1.1.1"
          opacity={0.85}
          zIndex={350}
        />}
        <ForecastGrid
          layer={weatherLayer}
          bounds={viewport}
          hourIndex={forecastHourIndex}
          forecastTime={forecastTimes[forecastHourIndex]}
          onStatus={setForecastMessage}
          onHoursChange={setForecastTimes}
          onHourChange={setInitialForecastHour}
        />
        <StormLayer enabled={stormEnabled} onStatus={setStormMessage} />
        <CircleMarker center={position} radius={12} pathOptions={{ color: '#91d9cb', fillColor: '#91d9cb', fillOpacity: 0.9 }}>
          <Popup><strong>{place.name}</strong><br />{weatherCode} · {temperature}</Popup>
        </CircleMarker>
        {favoriteWeather.filter(({ place: favorite }) => favorite.latitude !== place.latitude || favorite.longitude !== place.longitude).map(({ place: favorite, weather }) => {
          const favoriteCurrent = weather?.current;
          const condition = favoriteCurrent ? weatherDescription(favoriteCurrent.weather_code) : null;
          const color = condition?.mood === 'stormy' || condition?.mood === 'rainy'
            ? '#86b9cc'
            : condition?.mood === 'snowy'
              ? '#d5e5e6'
              : condition?.mood === 'cloudy'
                ? '#a9bec2'
                : '#e5c27b';
          const temperatureValue = favoriteCurrent ? Math.round(unit === 'F' ? favoriteCurrent.temperature_2m * 9 / 5 + 32 : favoriteCurrent.temperature_2m) : null;
          const favoriteWindValue = favoriteCurrent ? Math.round(windUnit === 'mph' ? favoriteCurrent.wind_speed_10m * 0.621371 : favoriteCurrent.wind_speed_10m) : null;
          return <CircleMarker key={`${favorite.latitude}-${favorite.longitude}`} center={[favorite.latitude, favorite.longitude]} radius={8} pathOptions={{ color, fillColor: color, fillOpacity: 0.85 }}>
            <Popup>
              <strong>{favorite.name}</strong><br />
              {favoriteCurrent
                ? <>{condition.label} · {temperatureValue}°{unit}<br />Humidity {favoriteCurrent.relative_humidity_2m}% · Wind {favoriteWindValue} {windUnit}</>
                : 'Weather unavailable'}
              <br /><button type="button" className="map-popup-action" onClick={() => onSelectPlace(favorite)}>Open forecast</button>
            </Popup>
          </CircleMarker>;
        })}
      </MapContainer>
      <div className="map-callout"><span className="map-dot" /><div><strong>{place.name}</strong><span>{weatherCode} · {temperature}</span></div></div>
      <div className="map-conditions" aria-label="Current conditions at selected location">
        <span><strong>{current?.relative_humidity_2m ?? '—'}%</strong> humidity</span>
        <span><strong>{windValue ?? '—'} {windUnit}</strong> wind</span>
        <span><strong>{current?.pressure_msl ?? '—'} hPa</strong> pressure</span>
        <span><strong>{precipitation} {precipUnit}</strong> precipitation</span>
        <span><strong>{current?.cloud_cover ?? '—'}%</strong> cloud cover</span>
      </div>
      <div className="map-layer-controls">
        <button type="button" aria-expanded={layersOpen} aria-label="Open map layers" className={layersOpen ? 'selected' : ''} onClick={() => setLayersOpen((open) => !open)}>
          <Layers2 size={16} /><span>Layers</span><ChevronDown size={13} />
        </button>
        <button type="button" className="map-locate-control" title="Use my current location" aria-label="Use my current location" onClick={onLocate}><Crosshair size={16} /></button>
        <button type="button" className="map-fullscreen-control" title={isFullscreen ? 'Exit fullscreen' : 'View map fullscreen'} aria-label={isFullscreen ? 'Exit fullscreen' : 'View map fullscreen'} onClick={toggleFullscreen}>
          {isFullscreen ? <Minimize2 size={16} /> : <Expand size={16} />}
        </button>
      </div>
      {layersOpen && <div className="map-layer-menu" role="dialog" aria-label="Map layers and overlays">
          <div className="map-layer-menu-heading"><strong>Map Layers</strong><small>Weather data & overlays</small></div>
          <span className="map-layer-section-label">BASE MAP</span>
          <div className="map-layer-options">
            {[['street', 'Street'], ['satellite', 'Satellite'], ['terrain', 'Terrain'], ['nasa', 'NASA True Color']].map(([id, label]) => <button key={id} type="button" aria-pressed={baseLayer === id} className={baseLayer === id ? 'selected' : ''} onClick={() => { setBaseLayer(id); setLayersOpen(false); }}>
              {id === 'street' ? <Layers2 size={14} /> : <Satellite size={14} />}{label}
            </button>)}
          </div>
          <span className="map-layer-section-label">WEATHER LAYERS</span>
          <div className="map-layer-options forecast-layer-options">
            {forecastHours.filter(h => h.category === 'weather').map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={weatherLayer === id} className={weatherLayer === id ? 'selected' : ''} onClick={() => chooseForecastLayer(id)}>
              <Icon size={14} />{label}
            </button>)}
          </div>
          <span className="map-layer-section-label">TEMPERATURE & ATMOSPHERE</span>
          <div className="map-layer-options forecast-layer-options">
            {forecastHours.filter(h => h.category === 'temp').map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={weatherLayer === id} className={weatherLayer === id ? 'selected' : ''} onClick={() => chooseForecastLayer(id)}>
              <Icon size={14} />{label}
            </button>)}
          </div>
          <span className="map-layer-section-label">AIR & OTHER</span>
          <div className="map-layer-options forecast-layer-options">
            {forecastHours.filter(h => h.category === 'other').map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={weatherLayer === id} className={weatherLayer === id ? 'selected' : ''} onClick={() => chooseForecastLayer(id)}>
              <Icon size={14} />{label}
            </button>)}
          </div>
          <span className="map-layer-section-label">LIVE DATA</span>
          <div className="map-layer-options">
            <button type="button" aria-pressed={radarEnabled} className={radarEnabled ? 'selected' : ''} onClick={chooseRadarLayer}><Radar size={14} />Radar</button>
            <button type="button" aria-pressed={stormEnabled} className={stormEnabled ? 'selected' : ''} onClick={() => { setStormEnabled((enabled) => !enabled); setLayersOpen(false); }}><Tornado size={14} />Storms</button>
            <button type="button" aria-pressed={firesEnabled} disabled={!FIRMS_MAP_KEY} className={firesEnabled ? 'selected' : ''} onClick={() => setFiresEnabled((enabled) => !enabled)}><Flame size={14} />Fires</button>
            <button type="button" aria-pressed={nightEnabled} className={nightEnabled ? 'selected' : ''} onClick={() => setNightEnabled((enabled) => !enabled)}><Sun size={14} />Day/Night</button>
          </div>
          <span className="map-layer-section-label">TOOLS</span>
          <div className="map-layer-options">
            <button type="button" aria-pressed={measurementMode === 'distance'} className={measurementMode === 'distance' ? 'selected' : ''} onClick={() => { setMeasurementMode((mode) => mode === 'distance' ? '' : 'distance'); setMeasurementPoints([]); setLayersOpen(false); }}><Ruler size={14} />Measure Distance</button>
            <button type="button" aria-pressed={measurementMode === 'area'} className={measurementMode === 'area' ? 'selected' : ''} onClick={() => { setMeasurementMode((mode) => mode === 'area' ? '' : 'area'); setMeasurementPoints([]); setLayersOpen(false); }}><Activity size={14} />Measure Area</button>
          </div>
          {!FIRMS_MAP_KEY && <p className="map-layer-note">Add <code>VITE_FIRMS_MAP_KEY</code> for fire detection.</p>}
        </div>}
      {measurementMode && <div className="map-measurement" role="status">
        <strong>{measurementMode === 'area' ? 'Measure area' : 'Measure distance'}</strong>
        <span>{selectedMeasurement}</span>
        <div><button type="button" onClick={() => setMeasurementPoints([])}>Clear points</button><button type="button" onClick={() => { setMeasurementMode(''); setMeasurementPoints([]); }}>Done</button></div>
      </div>}
      {selectedForecastLayer && <div className={`forecast-map-timeline${radarEnabled ? ' with-radar-timeline' : ''}`} aria-label={`${selectedForecastLayer.label} forecast controls`}>
        <div className="forecast-map-header">
          <span><Activity size={14} />{selectedForecastLayer.label} forecast <small>· Open-Meteo model</small></span>
          <strong>{forecastStatus || formatForecastTime(forecastTimes[forecastHourIndex])}</strong>
        </div>
        <div className="forecast-legend" aria-label={`${selectedForecastLayer.label} legend`}>
          {forecastLegend(weatherLayer).map(([color, label]) => <span key={label}><i style={{ background: color }} />{label}</span>)}
        </div>
        {forecastTimes.length > 0 && <div className="radar-controls">
          <button type="button" aria-label={forecastPlaying ? 'Pause forecast animation' : 'Play forecast animation'} onClick={() => setForecastPlaying((playing) => !playing)}>
            {forecastPlaying ? <Pause size={15} /> : <Play size={15} />}
          </button>
          <input
            type="range"
            min="0"
            max={forecastTimes.length - 1}
            value={Math.min(forecastHourIndex, forecastTimes.length - 1)}
            aria-label="Forecast time"
            onChange={(event) => { setForecastPlaying(false); setForecastHourIndex(Number(event.target.value)); }}
          />
          <button type="button" aria-label="Show current forecast hour" onClick={() => { setForecastPlaying(false); setForecastHourIndex(forecastStartHourIndex); }}><RotateCcw size={14} /></button>
        </div>}
      </div>}
      {radarEnabled && <div className="radar-timeline" aria-label="Radar playback controls">
        <div className="radar-timeline-header">
          <span><Radar size={14} /> {radarFrameIndex >= radarPastCount ? 'Nowcast Radar' : 'Historical Radar'} <small>· {radarFrameIndex >= radarPastCount ? 'Short-term forecast' : 'Past observations'}</small></span>
          <strong>{radarFrame ? `${formatRadarTime(radarFrame.time, timezone)}` : radarError ? 'Unavailable' : 'Loading…'}</strong>
        </div>
        {radarFrames.length > 0 && <>
          <div className="radar-controls">
            <button type="button" aria-label={radarPlaying ? 'Pause' : 'Play'} onClick={() => setRadarPlaying((playing) => !playing)}>
              {radarPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <input
              type="range"
              min="0"
              max={radarFrames.length - 1}
              value={radarFrameIndex}
              aria-label="Radar time"
              onChange={(event) => { setRadarPlaying(false); setRadarFrameIndex(Number(event.target.value)); }}
            />
            <button type="button" aria-label="Latest" onClick={() => { setRadarPlaying(false); setRadarFrameIndex(radarFrames.length - 1); }}><Clock size={14} /></button>
          </div>
          <div className="radar-time-range"><span>Past</span><span>Nowcast</span></div>
        </>}
        {radarError && <p className="radar-error" role="status">{radarError}</p>}
      </div>}
      {stormEnabled && stormStatus && <div className="map-status" role="status">{stormStatus}</div>}
    </div>
  );
}
