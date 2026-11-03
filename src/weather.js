const BASE_URL = 'https://api.open-meteo.com/v1/forecast';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const REVERSE_GEO_URL = 'https://photon.komoot.io/reverse';
const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const MAX_TRANSIENT_ATTEMPTS = 3;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function waitForRetry(delay, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new DOMException('The request was aborted.', 'AbortError'));
      return;
    }

    const timeout = globalThis.setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, delay);
    const abort = () => {
      globalThis.clearTimeout(timeout);
      reject(signal.reason || new DOMException('The request was aborted.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function retryDelay(response, attempt) {
  const retryAfter = response?.headers.get('Retry-After');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const retryAt = Number.isFinite(seconds) ? Date.now() + seconds * 1000 : Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) return Math.max(0, Math.min(retryAt - Date.now(), 5000));
  }

  return 600 * (2 ** attempt);
}

function apiError(response, data, fallbackMessage, lastAttempt) {
  if (response.status === 503 && lastAttempt) {
    return new Error('Weather updates are temporarily unavailable because the provider is busy. Please try again shortly.');
  }
  if ([502, 504].includes(response.status) && lastAttempt) {
    return new Error('The weather service is temporarily unreachable. Please try again shortly.');
  }
  if (response.status === 429 && lastAttempt) {
    return new Error('The weather service is receiving too many requests. Please wait a moment and try again.');
  }

  return new Error(data?.reason || `${fallbackMessage} (HTTP ${response.status}).`);
}

async function fetchJson(url, signal, fallbackMessage) {
  for (let attempt = 0; attempt < MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    let response;
    try {
      response = await fetch(url, { signal });
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw error;
      if (attempt === MAX_TRANSIENT_ATTEMPTS - 1) {
        throw new Error('Could not connect to the weather service. Check your internet connection and try again.');
      }
      await waitForRetry(600 * (2 ** attempt), signal);
      continue;
    }

    if (!response.ok && !RETRYABLE_STATUSES.has(response.status)) {
      let data = null;
      try {
        data = await response.json();
      } catch (error) {
        if (error.name === 'AbortError' || signal?.aborted) throw error;
      }
      throw apiError(response, data, fallbackMessage, false);
    }

    if (!response.ok && attempt < MAX_TRANSIENT_ATTEMPTS - 1) {
      await waitForRetry(retryDelay(response, attempt), signal);
      continue;
    }

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      if (error.name === 'AbortError' || signal?.aborted) throw error;
      if (response.ok) throw new Error(fallbackMessage);
    }

    if (response.ok) return data;
    throw apiError(response, data, fallbackMessage, true);
  }

  throw new Error(fallbackMessage);
}

export async function searchPlaces(query, signal) {
  const params = new URLSearchParams({ name: query, count: '6', language: 'en', format: 'json' });
  const data = await fetchJson(`${GEO_URL}?${params}`, signal, 'Could not search for places. Please try again.');
  return Array.isArray(data.results) ? data.results : [];
}

export async function reverseGeocode(latitude, longitude, signal) {
  const params = new URLSearchParams({
    lat: latitude.toFixed(5),
    lon: longitude.toFixed(5),
    lang: 'en',
  });
  const data = await fetchJson(`${REVERSE_GEO_URL}?${params}`, signal, 'Could not identify this location.');
  const properties = data.features?.[0]?.properties;
  if (!properties) return null;
  const name = properties.city || properties.town || properties.village || properties.municipality || properties.name || properties.locality;
  if (typeof name !== 'string' || !name.trim()) return null;
  return {
    name: name.trim(),
    admin1: properties.state || properties.county || '',
    country: properties.country || '',
  };
}

export async function getWeather(place, signal) {
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m,dew_point_2m,visibility',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max',
    timezone: 'auto',
    temperature_unit: 'celsius',
    wind_speed_unit: 'kmh',
    precipitation_unit: 'mm',
    forecast_days: '7',
  });
  const airParams = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    current: 'us_aqi,pm2_5,pm10,carbon_monoxide,nitrogen_dioxide,ozone',
    timezone: 'auto',
  });
  const [weather, air] = await Promise.all([
    fetchJson(`${BASE_URL}?${params}`, signal, 'Weather data is temporarily unavailable.'),
    fetch(`${AIR_URL}?${airParams}`, { signal })
      .then(async (airResponse) => {
        if (!airResponse.ok) {
          console.error(`Air quality data is unavailable (HTTP ${airResponse.status}).`);
          return null;
        }
        try {
          return await airResponse.json();
        } catch (error) {
          if (error.name === 'AbortError') throw error;
          console.error('Air quality response could not be read:', error);
          return null;
        }
      })
      .catch((error) => {
        if (error.name === 'AbortError') throw error;
        console.error('Air quality data is unavailable:', error);
        return null;
      }),
  ]);
  return { weather, air, fetchedAt: Date.now() };
}

export function weatherDescription(code) {
  if (code === 0) return { label: 'Clear sky', icon: 'sun', mood: 'sunny' };
  if (code === 1) return { label: 'Mainly clear', icon: 'sun-cloud', mood: 'sunny' };
  if (code === 2) return { label: 'Partly cloudy', icon: 'sun-cloud', mood: 'cloudy' };
  if (code === 3) return { label: 'Overcast', icon: 'cloud', mood: 'cloudy' };
  if ([45, 48].includes(code)) return { label: 'Foggy', icon: 'cloud-fog', mood: 'cloudy' };
  if ([51, 53, 55, 56, 57].includes(code)) return { label: 'Drizzle', icon: 'cloud-rain', mood: 'rainy' };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { label: 'Rain showers', icon: 'cloud-rain', mood: 'rainy' };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { label: 'Snowfall', icon: 'cloud-snow', mood: 'snowy' };
  if ([95, 96, 99].includes(code)) return { label: 'Thunderstorm', icon: 'cloud-lightning', mood: 'stormy' };
  return { label: 'Variable conditions', icon: 'cloud', mood: 'cloudy' };
}

export function aqiCategory(value) {
  if (value == null) return { label: 'Unavailable', note: 'Air quality estimates are not available right now.', color: '#91a0ad' };
  if (value <= 50) return { label: 'Good', note: 'Air quality is satisfactory with little or no risk.', color: '#7ac9a5' };
  if (value <= 100) return { label: 'Moderate', note: 'Sensitive individuals may wish to limit prolonged outdoor exertion.', color: '#e5c27b' };
  if (value <= 150) return { label: 'Unhealthy for sensitive groups', note: 'Sensitive groups may experience health effects.', color: '#e49b73' };
  if (value <= 200) return { label: 'Unhealthy', note: 'Everyone may begin to experience health effects.', color: '#de7d83' };
  if (value <= 300) return { label: 'Very unhealthy', note: 'Health alert: consider reducing outdoor activity.', color: '#b98fcd' };
  return { label: 'Hazardous', note: 'Health warning: reduce outdoor exposure.', color: '#b77c89' };
}
