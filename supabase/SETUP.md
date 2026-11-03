# Supabase sign-in and dashboard sync

1. Create a Supabase project and run [`schema.sql`](./schema.sql) in its SQL Editor.
2. In **Project Settings → API**, copy the Project URL and publishable key into a local `.env` file based on [`.env.example`](../.env.example). Never put a `service_role` key in this app.
3. In **Authentication → URL Configuration**, add the local app URL (`http://localhost:5173`) to the redirect allow list. Add your deployed site URL when deploying.
4. In **Authentication → Sign In / Providers**, enable Google and Facebook and add each provider's client ID and client secret. Keep provider secrets in Supabase; do not put them in `.env` or frontend code.
5. In each provider's developer console, use the Supabase callback URL shown by that provider's Supabase settings.
6. Restart the Vite server after creating `.env`, then open **Sign in** in Skyline.

The browser uses only the Supabase project URL and publishable/anon key. Row-level security in `schema.sql` ensures each authenticated user can only read or change their own dashboard row.

## Optional map fire detections

The map can display NASA FIRMS VIIRS detections from the previous 24 hours. FIRMS requires its own free map key:

1. Request a map key from [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov/api/area/).
2. Set `VITE_FIRMS_MAP_KEY` in the local `.env` file using the example template.
3. Restart the Vite development server and enable **Fires** in the map layer menu.

This key is a browser-visible map-service key, not an account password. Do not put unrelated credentials or private provider secrets in frontend environment variables. Fire detections can be delayed and are not an emergency alert.

## Map data and coverage

- Street maps: [OpenStreetMap](https://www.openstreetmap.org/copyright).
- Detected-location names: [Photon](https://photon.komoot.io/), using OpenStreetMap data; coordinates remain available if reverse geocoding cannot resolve a place.
- Static satellite basemap: Esri imagery; capture dates vary by location.
- Daily global satellite imagery: [NASA GIBS VIIRS](https://www.earthdata.nasa.gov/eosdis/science-system-description/eosdis-components/gibs); cloud cover, orbital timing, and processing mean imagery is not continuous live video.
- Past radar: [RainViewer](https://www.rainviewer.com/api.html); frame availability and radar coverage vary by region. This is recent history, not a precipitation forecast.
- Forecast overlays: [Open-Meteo](https://open-meteo.com/en/docs); model estimates sampled at map grid points, not observed radar or a provider's native global raster.
- Tropical storm positions, observed tracks, forecast paths, and forecast cones: the [Esri Active Hurricanes ArcGIS service](https://services9.arcgis.com/RHVPKKiFTONKtxq3/arcgis/rest/services/Active_Hurricanes_v1/FeatureServer), using NOAA/NHC and other reporting-agency data. Coverage and update frequency vary by basin; only systems with a reported position in the last 48 hours are shown.
- Fire detections: NASA FIRMS; requires the optional key above and is not guaranteed to include every fire.

Third-party data availability, geographic coverage, update intervals, and forecast accuracy vary. Skyline cannot guarantee parity with Zoom Earth's licensed and official provider feeds or 100% accuracy.
