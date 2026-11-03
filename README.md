# Skyline Weather

Skyline is a responsive weather dashboard built with React and Vite. It combines current conditions, forecasts, air-quality estimates, interactive weather maps, and an animated 3D weather scene.

## Features

- Search for cities or use your current location.
- View current conditions, hourly trends, and a 7-day forecast.
- Check US AQI and common pollutant estimates.
- Explore map layers, including forecast overlays, radar, satellite and terrain imagery, storm tracks, and optional fire detections.
- Save favorite places and switch temperature, wind-speed, precipitation, and theme preferences.
- Optionally sign in to sync dashboard data across devices.

Weather and air-quality data are provided by Open-Meteo. Other map overlays use public services and may have differing availability, coverage, or update times.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

Install dependencies and start the Vite development server:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite (usually `http://localhost:5173`).

## Environment variables

Most features work without environment variables. Copy `.env.example` to `.env` to configure optional integrations:

```powershell
Copy-Item .env.example .env
```

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Optional | Supabase project URL for sign-in and dashboard sync. |
| `VITE_SUPABASE_ANON_KEY` | Optional | Supabase publishable/anon key. Set this together with the project URL. |
| `VITE_FIRMS_MAP_KEY` | Optional | NASA FIRMS map key to enable fire detections on the weather map. |

To enable dashboard sync, configure Google and Facebook providers in Supabase Authentication and run [`supabase/schema.sql`](./supabase/schema.sql) in the Supabase SQL editor. The schema enables row-level security for each user's dashboard data. Restart the Vite server after changing `.env`.

Do not put private service-role keys or other secrets in `VITE_*` variables; Vite exposes these values to the browser.

## Build and preview

```sh
npm run build
npm run preview
```

The production bundle is generated in `dist/`. `npm run preview` serves that bundle locally for a production-style check.

## Project structure

```text
src/
  App.jsx             Main dashboard and views
  WeatherMap.jsx      Interactive weather map and overlays
  WeatherScene3D.jsx  Animated 3D weather visualization
  TemperatureChart.jsx Forecast charts
  weather.js          Weather, geocoding, and air-quality API access
  styles.css          Application styles
public/               Static images and animations
supabase/schema.sql   Optional dashboard-sync table and policies
```
