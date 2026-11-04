import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  Activity, Bookmark, Check, ChevronRight, Cloud, CloudFog,
  CloudLightning, CloudRain, CloudSnow, CloudSun, Compass, Droplets,
  Facebook, Globe2, Heart, LocateFixed, LogOut, MapPin, Menu, Moon,
  RefreshCw, Search, Settings2, Sun, Thermometer, UserRound, Wind, X,
} from 'lucide-react';
import { aqiCategory, getWeather, reverseGeocode, searchPlaces, weatherDescription } from './weather.js';
import { getSupabaseClient, isSupabaseConfigured } from './supabase.js';
const publicAsset = (filename) =>
  `${import.meta.env.BASE_URL}${filename}`;

const TemperatureChart = lazy(() => import('./TemperatureChart.jsx'));
const WeatherMap = lazy(() => import('./WeatherMap.jsx'));

const initialPlace = { name: 'San Francisco', admin1: 'California', country: 'United States', latitude: 37.7749, longitude: -122.4194 };
const WEATHER_CACHE_KEY = 'skyline-weather-cache';
const WINDY_THRESHOLD_KMH = 20;
const navItems = [
  { label: 'Overview', icon: Compass },
  { label: 'Forecast', icon: CloudSun },
  { label: 'Weather map', icon: Globe2 },
  { label: 'Air quality', icon: Activity },
  { label: 'Favorites', icon: Heart },
];

const round = (value) => Math.round(value);
const localHour = (time) => {
  const [hours, minutes] = time.slice(11, 16).split(':').map(Number);
  return new Date(2000, 0, 1, hours, minutes).toLocaleTimeString([], { hour: 'numeric' });
};
const weekday = (time) => {
  const [year, month, day] = time.split('-').map(Number);
  return new Date(year, month - 1, day, 12).toLocaleDateString([], { weekday: 'short' });
};
const formatClock = (time) => time ? time.slice(11, 16).replace(/^(\d):/, '0$1:') : '--:--';
function formatUpdatedTime(timestamp, timezone) {
  if (!timestamp) return 'Waiting for first update';
  return new Intl.DateTimeFormat([], {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: timezone || undefined,
  }).format(timestamp);
}

function readStoredArray(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || '[]');
    if (Array.isArray(stored)) return stored;
    console.warn(`Ignoring invalid stored ${key} data.`);
  } catch (error) {
    console.warn(`Could not read stored ${key} data:`, error);
  }
  return [];
}

function isSavedPlace(value) {
  return value && typeof value.name === 'string'
    && Number.isFinite(value.latitude) && Number.isFinite(value.longitude);
}

function validPlaces(value) {
  return Array.isArray(value) ? value.filter(isSavedPlace) : [];
}

function readStoredTheme() {
  try {
    return localStorage.getItem('skyline-theme') === 'dark';
  } catch (error) {
    console.warn('Could not read the saved theme:', error);
    return false;
  }
}

function persistStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.error(`Could not save ${key} data:`, error);
    return false;
  }
}

function weatherCacheKey(place) {
  return `${place.latitude.toFixed(3)},${place.longitude.toFixed(3)}`;
}

function readWeatherCache(place) {
  try {
    const stored = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || '{}');
    const snapshot = stored[weatherCacheKey(place)];
    if (snapshot?.weather?.current && snapshot.weather.daily && snapshot.weather.hourly
      && Number.isFinite(snapshot.fetchedAt)) {
      return snapshot;
    }
    return null;
  } catch (error) {
    console.warn('Could not read the saved weather forecast:', error);
    return null;
  }
}

function saveWeatherCache(place, result) {
  try {
    const stored = JSON.parse(localStorage.getItem(WEATHER_CACHE_KEY) || '{}');
    if (!stored || Array.isArray(stored) || typeof stored !== 'object') {
      console.warn('Ignoring invalid saved weather cache.');
      return;
    }
    const entries = Object.entries(stored)
      .filter(([, snapshot]) => snapshot?.weather?.current && Number.isFinite(snapshot.fetchedAt))
      .filter(([key]) => key !== weatherCacheKey(place));
    const next = Object.fromEntries([
      [weatherCacheKey(place), { weather: result.weather, air: result.air, fetchedAt: result.fetchedAt }],
      ...entries,
    ].slice(0, 8));
    localStorage.setItem(WEATHER_CACHE_KEY, JSON.stringify(next));
  } catch (error) {
    console.error('Could not save a local weather snapshot:', error);
  }
}

function WeatherIcon({ code, size = 22, className = '' }) {
  const { icon } = weatherDescription(code);
  const icons = {
    sun: Sun, 'sun-cloud': CloudSun, cloud: Cloud, 'cloud-fog': CloudFog,
    'cloud-rain': CloudRain, 'cloud-snow': CloudSnow, 'cloud-lightning': CloudLightning,
  };
  const Icon = icons[icon] ?? CloudSun;
  return <Icon size={size} strokeWidth={1.6} className={className} />;
}

function AirIllustration() {
  return (
    <svg className="air-illustration" viewBox="0 0 320 220" aria-hidden="true">
      <path className="air-cloud" d="M52 93c4-17 19-28 38-28 9-26 46-30 62-7 20-8 42 7 41 29 18 2 27 13 28 27H43c-2-10 1-17 9-21Z" />
      <path className="air-cloud air-cloud-back" d="M167 130c5-18 20-28 38-27 11-25 46-27 61-4 19-6 39 8 37 28 13 3 21 11 22 24H158c-1-10 2-16 9-21Z" />
      <path className="kite-tail" d="m193 112-28 82m28-82 43 66m-43-66 3 95" />
      <path className="kite-shape" d="m192 83 21 28-23 13-13-24Z" />
      <path className="kite-highlight" d="m192 83-2 41 23-13Z" />
    </svg>
  );
}

function TomorrowIllustration({ mood }) {
  return (
    <svg className={`tomorrow-illustration mood-${mood}`} viewBox="0 0 180 190" aria-hidden="true">
      {mood === 'rainy' || mood === 'stormy' ? <>
        <path className="umbrella-canopy" d="M28 66c11-37 45-56 70-56s59 19 70 56c-19-9-33-8-47 1-15-9-31-9-46 0-15-9-29-10-47-1Z" />
        <path className="umbrella-rib" d="M98 11v56m-23-47 23 47m23-47L98 67" />
        <path className="umbrella-handle" d="M98 67v29c0 11 18 11 18 0" />
        <circle className="person-head" cx="115" cy="119" r="11" />
        <path className="person-body" d="m106 131-10 43h44l-14-44c-6 5-13 5-20 1Z" />
        <path className="person-leg" d="m107 173-8 15m24-15 9 15" />
        <path className="person-arm" d="m106 137-18 17m31-17 12 16" />
      </> : <>
        <circle className="tomorrow-sun" cx="101" cy="72" r="37" />
        <path className="tomorrow-cloud" d="M39 119c3-14 15-23 29-23 8-21 38-23 50-4 17-6 33 6 32 23 13 1 21 9 22 20H32c-1-8 2-13 7-16Z" />
        {mood === 'snowy' && <g className="tomorrow-snow"><circle cx="73" cy="154" r="3" /><circle cx="111" cy="164" r="3" /><circle cx="143" cy="151" r="3" /></g>}
      </>}
    </svg>
  );
}

function App() {
  const reducedMotion = useReducedMotion();
  const [initialWeatherCache] = useState(() => readWeatherCache(initialPlace));
  const [place, setPlace] = useState(initialPlace);
  const [weather, setWeather] = useState(initialWeatherCache?.weather || null);
  const [air, setAir] = useState(initialWeatherCache?.air || null);
  const [loading, setLoading] = useState(true);
  const [pendingPlace, setPendingPlace] = useState(null);
  const [weatherFetchedAt, setWeatherFetchedAt] = useState(initialWeatherCache?.fetchedAt || null);
  const [weatherIsStale, setWeatherIsStale] = useState(Boolean(initialWeatherCache));
  const [error, setError] = useState('');
  const [retryPlace, setRetryPlace] = useState(null);
  const [retryNavigates, setRetryNavigates] = useState(false);
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [activeNav, setActiveNav] = useState('Overview');
  const [unit, setUnit] = useState('C');
  const [windUnit, setWindUnit] = useState('km/h');
  const [precipUnit, setPrecipUnit] = useState('mm');
  const [chartMode, setChartMode] = useState('temperature');
  const [favorites, setFavorites] = useState(() => readStoredArray('skyline-favorites'));
  const [history, setHistory] = useState(() => readStoredArray('skyline-history'));
  const [favoriteWeather, setFavoriteWeather] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [darkMode, setDarkMode] = useState(readStoredTheme);
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(isSupabaseConfigured);
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState('');
  const [syncStatus, setSyncStatus] = useState('idle');
  const [syncReadyUserId, setSyncReadyUserId] = useState(null);
  const [themeTransition, setThemeTransition] = useState(null);
  const [notice, setNotice] = useState('');
  const [clockNow, setClockNow] = useState(() => new Date());
  const searchRef = useRef(null);
  const abortRef = useRef(null);
  const locationLookupRef = useRef(null);
  const activeNavRef = useRef(activeNav);
  const forecastRef = useRef(null);
  const themeTransitionTimeoutRef = useRef(null);

  const signInWithProvider = async (provider) => {
    if (!isSupabaseConfigured) {
      setAuthError('Add your Supabase project URL and publishable key to the local environment file first.');
      return;
    }
    setAuthError('');
    try {
      const client = await getSupabaseClient();
      const { error: signInError } = await client.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (signInError) throw signInError;
    } catch (signInError) {
      console.error(`Could not sign in with ${provider}:`, signInError);
      setAuthError(signInError.message || `Could not start ${provider} sign-in.`);
    }
  };

  const signOut = async () => {
    if (!isSupabaseConfigured) return;
    setAuthError('');
    try {
      const client = await getSupabaseClient();
      const { error: signOutError } = await client.auth.signOut();
      if (signOutError) throw signOutError;
      setAuthOpen(false);
    } catch (signOutError) {
      console.error('Could not sign out:', signOutError);
      setAuthError(signOutError.message || 'Could not sign out. Please try again.');
    }
  };

  const toggleTheme = () => {
    if (themeTransitionTimeoutRef.current) {
      window.clearTimeout(themeTransitionTimeoutRef.current);
      themeTransitionTimeoutRef.current = null;
    }

    if (!reducedMotion) {
      const nextTheme = darkMode ? 'light' : 'dark';
      setThemeTransition(nextTheme);
      themeTransitionTimeoutRef.current = window.setTimeout(() => {
        setThemeTransition(null);
        themeTransitionTimeoutRef.current = null;
      }, 2500);
    } else {
      setThemeTransition(null);
    }
    setDarkMode((enabled) => !enabled);
  };

  const loadWeather = useCallback(async (nextPlace, { navigate = true } = {}) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    const navWhenRequested = activeNavRef.current;
    abortRef.current = controller;
    setLoading(true);
    setPendingPlace(nextPlace);
    setError('');
    setRetryPlace(null);
    if (navigate) {
      setQuery('');
      setSuggestions([]);
      setSidebarOpen(false);
    }
    try {
      const result = await getWeather(nextPlace, controller.signal);
      setPlace(nextPlace);
      setWeather(result.weather);
      setAir(result.air);
      setWeatherFetchedAt(result.fetchedAt);
      setWeatherIsStale(false);
      saveWeatherCache(nextPlace, result);
      setRetryPlace(null);
      if (navigate && activeNavRef.current === navWhenRequested) {
        setActiveNav('Overview');
      }
      const recent = [nextPlace, ...readStoredArray('skyline-history')
        .filter((item) => item.latitude !== nextPlace.latitude || item.longitude !== nextPlace.longitude)].slice(0, 5);
      setHistory(recent);
      if (!persistStoredJson('skyline-history', recent)) {
        setRetryPlace(null);
        setError('Weather loaded, but search history could not be saved in this browser.');
      }
    } catch (loadError) {
      if (loadError.name !== 'AbortError') {
        const cached = readWeatherCache(nextPlace);
        setRetryPlace(nextPlace);
        setRetryNavigates(navigate);
        if (cached) {
          setPlace(nextPlace);
          setWeather(cached.weather);
          setAir(cached.air);
          setWeatherFetchedAt(cached.fetchedAt);
          setWeatherIsStale(true);
          if (navigate && activeNavRef.current === navWhenRequested) setActiveNav('Overview');
          setError(`Live weather is temporarily unavailable. Showing the saved forecast from ${formatUpdatedTime(cached.fetchedAt, cached.weather.timezone)}.`);
        } else {
          setError(loadError.message || 'Weather data is temporarily unavailable. Please try again shortly.');
        }
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setPendingPlace(null);
        setNotice('');
      }
    }
  }, []);

  useEffect(() => {
    activeNavRef.current = activeNav;
  }, [activeNav]);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let subscription;

    const restoreSession = async () => {
      try {
        const client = await getSupabaseClient();
        if (!client) throw new Error('Supabase is not configured.');
        if (!active) return;
        const { data: { subscription: authSubscription } } = client.auth.onAuthStateChange((_event, nextSession) => {
          if (active) {
            setSession(nextSession);
            setAuthLoading(false);
            setAuthError('');
          }
        });
        subscription = authSubscription;
        const { data, error: sessionError } = await client.auth.getSession();
        if (sessionError) throw sessionError;
        if (active) {
          setSession(data.session);
          setAuthLoading(false);
        }
      } catch (sessionError) {
        if (active) {
          console.error('Could not restore the sign-in session:', sessionError);
          setAuthError(sessionError.message || 'Could not restore your sign-in session.');
          setAuthLoading(false);
        }
      }
    };
    void restoreSession();
    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!isSupabaseConfigured || !userId) {
      setSyncStatus('idle');
      setSyncReadyUserId(null);
      return undefined;
    }
    let active = true;
    setSyncStatus('loading');
    setSyncReadyUserId(null);
    setAuthError('');

    const loadDashboard = async () => {
      try {
        const client = await getSupabaseClient();
        if (!client) throw new Error('Supabase is not configured.');
        const { data, error: dashboardError } = await client
          .from('user_dashboard')
          .select('favorites, history, preferences, selected_place')
          .eq('user_id', userId)
          .maybeSingle();
        if (dashboardError) throw dashboardError;
        if (!active) return;

        if (data) {
          setFavorites(validPlaces(data.favorites));
          setHistory(validPlaces(data.history));
          const preferences = data.preferences && typeof data.preferences === 'object'
            ? data.preferences
            : {};
          if (['C', 'F'].includes(preferences.unit)) setUnit(preferences.unit);
          if (['km/h', 'mph'].includes(preferences.windUnit)) setWindUnit(preferences.windUnit);
          if (['mm', 'in'].includes(preferences.precipUnit)) setPrecipUnit(preferences.precipUnit);
          if (typeof preferences.darkMode === 'boolean') setDarkMode(preferences.darkMode);
          if (isSavedPlace(data.selected_place)) {
            void loadWeather(data.selected_place, { navigate: false });
          }
        } else {
          const { error: createError } = await client.from('user_dashboard').upsert({
            user_id: userId,
            favorites,
            history,
            preferences: { unit, windUnit, precipUnit, darkMode },
            selected_place: place,
          }, { onConflict: 'user_id' });
          if (createError) throw createError;
        }
        if (active) {
          setSyncStatus('ready');
          setSyncReadyUserId(userId);
        }
      } catch (dashboardError) {
        if (active) {
          console.error('Could not load the account dashboard:', dashboardError);
          setSyncStatus('error');
          setSyncReadyUserId(null);
          setAuthError(dashboardError.message || 'Could not load your synced dashboard.');
        }
      }
    };
    void loadDashboard();
    return () => { active = false; };
  }, [session?.user?.id]);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!isSupabaseConfigured || !userId || syncReadyUserId !== userId) return undefined;
    const timeout = window.setTimeout(async () => {
      setSyncStatus('saving');
      try {
        const client = await getSupabaseClient();
        if (!client) throw new Error('Supabase is not configured.');
        const { error: saveError } = await client.from('user_dashboard').upsert({
          user_id: userId,
          favorites,
          history,
          preferences: { unit, windUnit, precipUnit, darkMode },
          selected_place: place,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
        if (saveError) throw saveError;
        setSyncStatus('ready');
      } catch (saveError) {
        console.error('Could not save the account dashboard:', saveError);
        setSyncStatus('error');
        setAuthError(saveError.message || 'Could not save your dashboard changes.');
      }
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [session?.user?.id, syncReadyUserId, favorites, history, unit, windUnit, precipUnit, darkMode, place]);

  useEffect(() => () => {
    if (themeTransitionTimeoutRef.current) window.clearTimeout(themeTransitionTimeoutRef.current);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('skyline-theme', darkMode ? 'dark' : 'light');
    } catch (error) {
      console.error('Could not save the selected theme:', error);
    }
  }, [darkMode]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (activeNav === 'Forecast') {
      forecastRef.current?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    }
  }, [activeNav, reducedMotion]);

  useEffect(() => {
    loadWeather(initialPlace);
    return () => {
      abortRef.current?.abort();
      locationLookupRef.current?.abort();
    };
  }, [loadWeather]);

  useEffect(() => {
    const controller = new AbortController();
    const interval = window.setInterval(async () => {
      try {
        const result = await getWeather(place, controller.signal);
        setWeather(result.weather);
        setAir(result.air);
        setWeatherFetchedAt(result.fetchedAt);
        setWeatherIsStale(false);
        saveWeatherCache(place, result);
        setError('');
        setRetryPlace(null);
      } catch (refreshError) {
        if (refreshError.name !== 'AbortError') {
          setWeatherIsStale(true);
          setRetryPlace(place);
          setRetryNavigates(false);
          setError(`${refreshError.message || 'Weather refresh failed.'} Showing the last available forecast.`);
        }
      }
    }, 15 * 60 * 1000);
    return () => {
      controller.abort();
      window.clearInterval(interval);
    };
  }, [place]);

  useEffect(() => {
    const saved = readStoredArray('skyline-favorites');
    if (!persistStoredJson('skyline-favorites', favorites)) {
      setRetryPlace(null);
      setError('Favorites could not be saved in this browser.');
      return undefined;
    }
    if (JSON.stringify(saved) !== JSON.stringify(favorites) && favorites.length) {
      setNotice('Location saved to favorites');
      const timeout = window.setTimeout(() => setNotice(''), 2400);
      return () => window.clearTimeout(timeout);
    }
  }, [favorites]);

  useEffect(() => {
    if (!query.trim()) {
      setSuggestions([]);
      setSearching(false);
      setSearchError('');
      return undefined;
    }
    setSuggestions([]);
    setSearching(true);
    setSearchError('');
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        setSuggestions(await searchPlaces(query.trim(), controller.signal));
      } catch (searchError) {
        if (searchError.name !== 'AbortError') {
          setSearchError(searchError.message || 'Could not search for places.');
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 300);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!['Favorites', 'Weather map'].includes(activeNav)) return undefined;
    if (favorites.length === 0) {
      setFavoriteWeather([]);
      return undefined;
    }
    let active = true;
    const controller = new AbortController();
    Promise.all(favorites.map(async (favorite) => {
      try {
        const result = await getWeather(favorite, controller.signal);
        return { place: favorite, weather: result.weather };
      } catch (favoriteError) {
        if (favoriteError.name !== 'AbortError') console.error('Unable to load favorite weather:', favoriteError);
        return { place: favorite, weather: null };
      }
    })).then((items) => { if (active) setFavoriteWeather(items); });
    return () => {
      active = false;
      controller.abort();
    };
  }, [activeNav, favorites]);

  const current = weather?.current;
  const daily = weather?.daily;
  const locationTimeFormatter = useMemo(() => weather?.timezone
    ? new Intl.DateTimeFormat([], {
      timeZone: weather.timezone,
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    })
    : null, [weather?.timezone]);
  const locationTime = locationTimeFormatter?.format(clockNow);
  const sunriseTime = daily?.sunrise?.[0];
  const sunsetTime = daily?.sunset?.[0];
  const isDay = current?.time && sunriseTime && sunsetTime
    ? current.time >= sunriseTime && current.time < sunsetTime
    : current?.is_day === 1;
  const tomorrowMood = weatherDescription(daily?.weather_code?.[1]).mood;
  const tomorrowIsRainy = tomorrowMood === 'rainy' || tomorrowMood === 'stormy';
  const hourly = useMemo(() => {
    if (!weather?.hourly) return [];
    const start = weather.hourly.time.findIndex((time) => time >= current.time);
    return weather.hourly.time.slice(Math.max(start, 0), Math.max(start, 0) + 24).map((time, index) => {
      const sourceIndex = Math.max(start, 0) + index;
      return {
        time,
        label: index === 0 ? 'Now' : localHour(time),
        temp: weather.hourly.temperature_2m[sourceIndex],
        code: weather.hourly.weather_code[sourceIndex],
        rain: weather.hourly.precipitation_probability[sourceIndex] ?? 0,
        wind: weather.hourly.wind_speed_10m[sourceIndex] ?? 0,
      };
    });
  }, [weather, current?.time]);
  const chartData = useMemo(() => hourly.slice(0, 12).map((hour) => ({
    time: hour.label,
    temperature: round(convertTemp(hour.temp, unit)),
    precipitation: hour.rain,
    wind: round(convertWind(hour.wind, windUnit)),
  })), [hourly, unit, windUnit]);
  const dailyChartData = useMemo(() => daily?.time.map((time, index) => ({
    time: index === 0 ? 'Today' : weekday(time),
    high: round(convertTemp(daily.temperature_2m_max[index], unit)),
    low: round(convertTemp(daily.temperature_2m_min[index], unit)),
  })) ?? [], [daily, unit]);
  const timeline = useMemo(() => {
    if (!hourly.length) return [];
    return [0, 4, 8, 12, 16, 20].filter((index) => index < hourly.length).map((index) => {
      const hour = hourly[index];
      const hourOfDay = Number(hour.time.slice(11, 13));
      const period = hourOfDay < 11 ? 'Morning' : hourOfDay < 16 ? 'Afternoon' : hourOfDay < 20 ? 'Evening' : 'Night';
      return { ...hour, period };
    });
  }, [hourly]);
  const isFavorite = favorites.some((item) => item.latitude === place.latitude && item.longitude === place.longitude);
  const activeCode = current?.weather_code ?? 1;
  const activeMood = weatherDescription(activeCode).mood;
  const isRainy = ['rainy', 'stormy'].includes(activeMood);
  const isCloudy = ['cloudy', 'snowy'].includes(activeMood);
  const isWindy = activeMood === 'sunny' && current?.wind_speed_10m >= WINDY_THRESHOLD_KMH;
  
const weatherScene = isRainy
  ? isDay
    ? {
        animation: publicAsset('day-rain-scene.gif'),
        poster: publicAsset('day-rain-scene-poster.png')
      }
    : {
        animation: publicAsset('weather-scene.gif'),
        poster: publicAsset('weather-scene-poster.png')
      }
  : isCloudy
    ? {
        animation: publicAsset('cloudy-scene.gif'),
        poster: publicAsset('cloudy-scene-poster.png')
      }
    : isWindy
      ? {
          animation: publicAsset('wind-scene.gif'),
          poster: publicAsset('wind-scene-poster.png')
        }
      : isDay
        ? {
            animation: publicAsset('daylight-scene.gif'),
            poster: publicAsset('daylight-scene-poster.png')
          }
        : {
            animation: publicAsset('night-scene.gif'),
            poster: publicAsset('night-scene-poster.png')
          };

  const airNow = air?.current;
  const aqi = airNow?.us_aqi;
  const airStatus = aqiCategory(aqi);
  const timelineTemperatures = timeline.map((hour) => hour.temp);
  const timelineLow = Math.min(...timelineTemperatures);
  const timelineRange = Math.max(...timelineTemperatures) - timelineLow || 1;
  const timelinePath = timeline.map((hour, index) => {
    const x = timeline.length === 1 ? 200 : 28 + index * (344 / (timeline.length - 1));
    const y = 76 - ((hour.temp - timelineLow) / timelineRange) * 43;
    return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
  }).join(' ');
  const rainSoon = useMemo(() => {
    if (!hourly.length) return null;
    const upcoming = hourly.slice(0, 12).find((hour) => hour.rain >= 50);
    if (!upcoming || upcoming.label === 'Now') return null;
    return { label: upcoming.label, rain: upcoming.rain };
  }, [hourly]);
  const advisoryChips = useMemo(() => {
    const chips = [];
    if (current?.wind_speed_10m >= WINDY_THRESHOLD_KMH) {
      chips.push({ icon: Wind, text: `Windy — gusty ${round(convertWind(current.wind_speed_10m, windUnit))} ${windUnit} winds` });
    }
    if (daily?.uv_index_max?.[0] >= 6) {
      chips.push({ icon: Sun, text: `Strong sun — UV index ${round(daily.uv_index_max[0])}, wear protection` });
    }
    if (aqi != null && aqi > 100) {
      chips.push({ icon: Activity, text: `Air is ${airStatus.label.toLowerCase()} — AQI ${round(aqi)}` });
    }
    if (current?.relative_humidity_2m >= 85) {
      chips.push({ icon: Droplets, text: `Very humid — ${round(current.relative_humidity_2m)}% humidity` });
    }
    return chips;
  }, [current, daily, aqi, airStatus.label, windUnit]);
  const freshness = useMemo(() => {
    if (!weatherFetchedAt) return null;
    const minutes = Math.max(0, Math.round((clockNow - weatherFetchedAt) / 60000));
    return minutes < 1 ? 'Updated just now' : minutes < 60 ? `Updated ${minutes} min ago` : `Updated ${round(minutes / 60)} h ago`;
  }, [clockNow, weatherFetchedAt]);
  const sunriseMinute = Number(daily?.sunrise?.[0]?.slice(11, 13)) * 60 + Number(daily?.sunrise?.[0]?.slice(14, 16));
  const sunsetMinute = Number(daily?.sunset?.[0]?.slice(11, 13)) * 60 + Number(daily?.sunset?.[0]?.slice(14, 16));
  const currentMinute = Number(current?.time?.slice(11, 13)) * 60 + Number(current?.time?.slice(14, 16));
  const daylightProgress = sunsetMinute > sunriseMinute
    ? Math.max(0, Math.min(1, (currentMinute - sunriseMinute) / (sunsetMinute - sunriseMinute)))
    : 0.5;

  function choosePlace(result) {
    loadWeather({
      name: result.name,
      admin1: result.admin1 || '',
      country: result.country || '',
      latitude: result.latitude,
      longitude: result.longitude,
    });
  }

  function toggleFavorite() {
    setFavorites((existing) => isFavorite
      ? existing.filter((item) => item.latitude !== place.latitude || item.longitude !== place.longitude)
      : [...existing, place]);
  }

  function detectLocation({ navigate = true } = {}) {
    locationLookupRef.current?.abort();
    const controller = new AbortController();
    locationLookupRef.current = controller;
    setError('');
    setRetryPlace(null);
    setNotice('');
    if (!navigator.geolocation) {
      setError('Location services are not supported by this browser.');
      return;
    }
    setNotice('Finding your location…');
    navigator.geolocation.getCurrentPosition(async ({ coords }) => {
      if (controller.signal.aborted) return;
      const { latitude, longitude } = coords;
      const coordinateName = `Location ${Math.abs(latitude).toFixed(2)}° ${latitude < 0 ? 'S' : 'N'}, ${Math.abs(longitude).toFixed(2)}° ${longitude < 0 ? 'W' : 'E'}`;
      let location = { name: coordinateName, admin1: '', country: '', latitude, longitude };
      setNotice('Identifying your location…');
      try {
        const address = await reverseGeocode(latitude, longitude, controller.signal);
        if (address) location = { ...location, ...address };
        else console.warn('Reverse geocoding returned no place name; showing coordinates instead.');
      } catch (locationError) {
        if (locationError.name === 'AbortError') return;
        console.warn('Could not resolve a place name for the detected location:', locationError);
      }
      if (controller.signal.aborted) return;
      setNotice('Loading forecast for your location…');
      loadWeather(location, { navigate });
    }, (locationError) => {
      if (controller.signal.aborted) return;
      setNotice('');
      setError(locationError.code === 1 ? 'Location permission was denied. You can still search for a city.' : 'Unable to determine your location. Please try again.');
    }, { timeout: 10000 });
  }

  function renderAirQuality() {
    const pollutants = [
      ['PM2.5', airNow?.pm2_5, 'μg/m³'], ['PM10', airNow?.pm10, 'μg/m³'],
      ['Carbon monoxide', airNow?.carbon_monoxide, 'μg/m³'],
      ['Nitrogen dioxide', airNow?.nitrogen_dioxide, 'μg/m³'], ['Ozone', airNow?.ozone, 'μg/m³'],
    ];
    const airMood = aqi == null ? 'air-none' : aqi <= 50 ? 'air-good' : aqi <= 100 ? 'air-moderate' : aqi <= 200 ? 'air-bad' : 'air-very-bad';
    return (
      <section className="page-section air-page">
        <SectionHeading eyebrow="THE AIR AROUND YOU" title="Air quality" subtitle="A closer look at the latest modeled air-quality estimates." />
        <div className={`air-overview panel ${airMood}`}>
          <div className="aqi-ring" style={{ '--aqi-color': airStatus.color }}>
            <div><strong>{aqi == null ? '—' : round(aqi)}</strong><span>US AQI</span></div>
          </div>
          <div className="air-overview-copy">
            <span className="eyebrow">CURRENT AIR QUALITY</span>
            <h2 style={{ color: airStatus.color }}>{airStatus.label}</h2>
            <p>{airStatus.note}</p>
            <div className="aqi-scale"><span>Good</span><span>Moderate</span><span>Unhealthy</span><div><i style={{ left: `${Math.min((aqi || 0) / 300 * 100, 100)}%`, background: airStatus.color }} /></div></div>
          </div>
          <div className="air-art"><span /><i /><i /><i /><i />{aqi != null && <b className="air-particles" aria-hidden="true">{Array.from({ length: 8 }, (_, n) => <em key={n} style={{ '--i': n }} />)}</b>}</div>
        </div>
        <div className="pollutant-grid">
          {pollutants.map(([label, value, unitName]) => <div className="panel pollutant-card" key={label}>
            <span className="pollutant-label">{label}</span>
            <strong>{value == null ? '—' : Number(value).toFixed(1)} <small>{unitName}</small></strong>
            <span className="muted">Latest model estimate</span>
          </div>)}
        </div>
        <p className="data-note">US AQI and pollutant data from Open-Meteo. AQI categories are general guidance, not a medical assessment or substitute for official health advice.</p>
      </section>
    );
  }

  function renderFavorites() {
    return (
      <section className="page-section">
        <SectionHeading eyebrow="YOUR PERSONAL WEATHER LIST" title="Favorite places" subtitle="Keep the places you care about close, and compare their live conditions at a glance." />
        {!favorites.length ? <div className="empty-state panel"><div className="empty-icon"><Heart size={25} /></div><h3>No saved places yet</h3><p>Save a city using the bookmark on its weather card.</p><button className="button-primary" onClick={() => setActiveNav('Overview')}>Explore the dashboard</button></div> :
          <>
            <div className="favorite-grid">{favoriteWeather.map(({ place: favorite, weather: favoriteData }) => {
              const details = favoriteData?.current;
              return <motion.article layout={!reducedMotion} className="panel favorite-card" key={`${favorite.latitude}-${favorite.longitude}`}>
                <span className="favorite-card-top"><span><MapPin size={14} />{favorite.country}</span><button className="remove-favorite" aria-label={`Remove ${favorite.name} from favorites`} onClick={() => setFavorites((items) => items.filter((item) => item.latitude !== favorite.latitude || item.longitude !== favorite.longitude))}><X size={15} /></button></span>
                <button className="favorite-card-open" onClick={() => loadWeather(favorite)} aria-label={`Open ${favorite.name} weather forecast`}>
                  <strong className="favorite-city">{favorite.name}</strong><span className="favorite-region">{favorite.admin1 || 'Local forecast'}</span>
                  <span className="favorite-weather"><WeatherIcon code={details?.weather_code ?? 1} size={27} /><strong>{details ? `${round(convertTemp(details.temperature_2m, unit))}°` : '—'}</strong></span>
                  <span className="favorite-condition">{details ? weatherDescription(details.weather_code).label : 'Weather unavailable'}{details && <span> · feels {round(convertTemp(details.apparent_temperature, unit))}°</span>}</span>
                </button>
              </motion.article>;
            })}</div>
            <section className="panel city-comparison" aria-labelledby="city-comparison-title">
              <div className="section-title-row comparison-heading">
                <div><span className="eyebrow">LIVE CONDITIONS</span><h2 id="city-comparison-title">City comparison</h2></div>
                <span className="muted">Open a city forecast by selecting its name</span>
              </div>
              <div className="comparison-table-wrap">
                <table className="comparison-table">
                  <thead><tr><th scope="col">City</th><th scope="col">Conditions</th><th scope="col">Temperature</th><th scope="col">Feels like</th><th scope="col">Humidity</th><th scope="col">Wind</th></tr></thead>
                  <tbody>{favoriteWeather.map(({ place: favorite, weather: favoriteData }) => {
                    const details = favoriteData?.current;
                    return <tr key={`${favorite.latitude}-${favorite.longitude}`}>
                      <th scope="row"><button className="comparison-city" onClick={() => loadWeather(favorite)}>{favorite.name}<span>{favorite.admin1 || favorite.country}</span></button></th>
                      <td>{details ? weatherDescription(details.weather_code).label : 'Weather unavailable'}</td>
                      <td>{details ? `${round(convertTemp(details.temperature_2m, unit))}°${unit}` : '—'}</td>
                      <td>{details ? `${round(convertTemp(details.apparent_temperature, unit))}°${unit}` : '—'}</td>
                      <td>{details ? `${round(details.relative_humidity_2m)}%` : '—'}</td>
                      <td>{details ? `${round(convertWind(details.wind_speed_10m, windUnit))} ${windUnit}` : '—'}</td>
                    </tr>;
                  })}</tbody>
                </table>
              </div>
            </section>
          </>}
      </section>
    );
  }

  function renderMap() {
    return (
      <section className="page-section">
        <SectionHeading eyebrow="LIVE MAP & FORECAST" title="Weather map" subtitle="Explore satellite imagery, recent radar, forecast layers, storm tracks, and fire detections. Coverage depends on each public data source." />
        <Suspense fallback={<div className="panel map-panel map-loading">Loading map…</div>}>
          <WeatherMap
            place={place}
            favoriteWeather={favoriteWeather}
            weatherCode={weatherDescription(activeCode).label}
            temperature={current ? `${round(convertTemp(current.temperature_2m, unit))}°` : '--'}
            unit={unit}
            windUnit={windUnit}
            precipUnit={precipUnit}
            current={current}
            timezone={weather?.timezone}
            onSelectPlace={loadWeather}
            onLocate={() => detectLocation({ navigate: false })}
          />
        </Suspense>
      </section>
    );
  }

  function renderSettings() {
    return (
      <section className="page-section">
        <SectionHeading eyebrow="MAKE IT YOURS" title="Settings" subtitle="Tune the dashboard to the way you like to check the weather." />
        <div className="settings-list panel">
          <div className="setting-row"><div className="setting-icon"><Thermometer size={19} /></div><div className="setting-copy"><strong>Temperature</strong><span>Choose your preferred temperature unit</span></div><div className="unit-toggle" role="group" aria-label="Temperature unit"><button aria-pressed={unit === 'C'} className={unit === 'C' ? 'selected' : ''} onClick={() => setUnit('C')}>°C</button><button aria-pressed={unit === 'F'} className={unit === 'F' ? 'selected' : ''} onClick={() => setUnit('F')}>°F</button></div></div>
          <div className="setting-row"><div className="setting-icon"><Wind size={19} /></div><div className="setting-copy"><strong>Wind speed</strong><span>Choose how wind speed is displayed</span></div><div className="unit-toggle" role="group" aria-label="Wind speed unit"><button aria-pressed={windUnit === 'km/h'} className={windUnit === 'km/h' ? 'selected' : ''} onClick={() => setWindUnit('km/h')}>km/h</button><button aria-pressed={windUnit === 'mph'} className={windUnit === 'mph' ? 'selected' : ''} onClick={() => setWindUnit('mph')}>mph</button></div></div>
          <div className="setting-row"><div className="setting-icon"><Droplets size={19} /></div><div className="setting-copy"><strong>Precipitation</strong><span>Choose how precipitation is displayed</span></div><div className="unit-toggle" role="group" aria-label="Precipitation unit"><button aria-pressed={precipUnit === 'mm'} className={precipUnit === 'mm' ? 'selected' : ''} onClick={() => setPrecipUnit('mm')}>mm</button><button aria-pressed={precipUnit === 'in'} className={precipUnit === 'in' ? 'selected' : ''} onClick={() => setPrecipUnit('in')}>in</button></div></div>
          <div className="setting-row"><div className="setting-icon"><Bookmark size={19} /></div><div className="setting-copy"><strong>Search history</strong><span>{history.length ? history.map((item) => item.name).join(' · ') : 'Your recent searches will appear here'}</span></div><button className="text-button" onClick={() => { try { localStorage.removeItem('skyline-history'); setHistory([]); } catch (storageError) { console.error('Could not clear search history:', storageError); setRetryPlace(null); setError('Search history could not be cleared in this browser.'); } }}>Clear history</button></div>
        </div>
        <p className="data-note">Weather and air quality data are provided by Open-Meteo. Map tiles © OpenStreetMap contributors.</p>
      </section>
    );
  }

  return (
    <div className={`app-shell editorial-theme${darkMode ? ' dark-mode' : ''}`}>
  {themeTransition && (
    <div
      className={`theme-transition-overlay${themeTransition === 'dark' ? ' reverse' : ''}`}
      aria-hidden="true"
    >
      <img
        src={publicAsset(
          themeTransition === 'dark'
            ? 'theme-dark-transition.gif'
            : 'theme-light-transition.gif'
        )}
        alt=""
      />
    </div>
  )}
      <aside className={`sidebar${sidebarOpen ? ' sidebar-open' : ''}`}>
        <a href="#" className="brand" onClick={(event) => { event.preventDefault(); setActiveNav('Overview'); setSidebarOpen(false); }}><span className="brand-mark"><Sun size={21} /></span><span>skyline<span className="brand-dot">.</span></span></a>
        <button className="icon-button desktop-theme-toggle" aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} aria-pressed={darkMode} onClick={toggleTheme}>{darkMode ? <Sun size={19} /> : <Moon size={19} />}</button>
        <button className="sidebar-close icon-button" aria-label="Close navigation" onClick={() => setSidebarOpen(false)}><X size={18} /></button>
        <div className="side-label">WORKSPACE</div>
        <nav id="app-navigation" className="side-nav" aria-label="Main navigation">
          {navItems.map(({ label, icon: Icon }) => <button key={label} aria-label={label} aria-current={activeNav === label ? 'page' : undefined} title={label} className={`nav-link${activeNav === label ? ' active' : ''}`} onClick={() => { setActiveNav(label); setSidebarOpen(false); }}><Icon size={18} strokeWidth={1.8} /><span>{label}</span>{label === 'Favorites' && favorites.length > 0 && <span className="nav-count">{favorites.length}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><div className="tip-glow"><Sun size={18} /></div><strong>A little more sunshine</strong><p>Stay ahead of the weather, wherever life takes you.</p><button onClick={detectLocation}>Use my location <ChevronRight size={14} /></button></div>
          <button aria-label={session ? 'Manage account' : 'Sign in'} title={session ? 'Manage account' : 'Sign in'} className="nav-link account-link" onClick={() => { setAuthError(''); setAuthOpen(true); }}><UserRound size={18} /><span>{session ? 'Account' : 'Sign in'}</span></button>
          <button aria-label="Settings" title="Settings" className={`nav-link settings-link${activeNav === 'Settings' ? ' active' : ''}`} onClick={() => { setActiveNav('Settings'); setSidebarOpen(false); }}><Settings2 size={18} /><span>Settings</span></button>
          <span className="sidebar-version">SKYLINE WEATHER · 01</span>
        </div>
      </aside>
      {sidebarOpen && <button className="sidebar-scrim" aria-label="Close menu" onClick={() => setSidebarOpen(false)} />}
      <main className="main-content">
        <header className="topbar">
          <button className="mobile-menu icon-button" aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls="app-navigation" onClick={() => setSidebarOpen(true)}><Menu size={20} /></button>
          <button className="icon-button theme-toggle" aria-label={`Switch to ${darkMode ? 'light' : 'dark'} mode`} title={`Switch to ${darkMode ? 'light' : 'dark'} mode`} aria-pressed={darkMode} onClick={toggleTheme}>{darkMode ? <Sun size={18} /> : <Moon size={18} />}</button>
          <div className="breadcrumb">
            {activeNav === 'Overview' || activeNav === 'Forecast'
              ? <div className="editorial-greeting"><span>Weather, today</span><strong>{place.name}</strong>{locationTime && <time className="editorial-local-time" dateTime={clockNow.toISOString()} aria-label={`Local time in ${place.name}`}>{locationTime}</time>}</div>
              : <><span>Workspace</span><ChevronRight size={14} /><strong>{activeNav}</strong></>}
          </div>
          <div className="topbar-actions">
            <div className="search-wrap" ref={searchRef}>
              <Search size={17} className="search-icon" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} onFocus={() => setSearchFocused(true)} onBlur={() => window.setTimeout(() => setSearchFocused(false), 160)} onKeyDown={(event) => { if (event.key === 'Enter' && suggestions[0]) choosePlace(suggestions[0]); if (event.key === 'ArrowDown') { event.preventDefault(); searchRef.current?.querySelector('.suggestion')?.focus(); } if (event.key === 'Escape') { setQuery(''); setSuggestions([]); } }} placeholder="Search any city..." aria-label="Search any city" aria-busy={searching} />
              {query && <button className="clear-search" aria-label="Clear search" onClick={() => { setQuery(''); setSuggestions([]); }}><X size={15} /></button>}
              <AnimatePresence>{searchFocused && query && <motion.div id="city-search-results" className="search-results" role="region" aria-label="City search results" initial={reducedMotion ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}>
                {searching && <div className="search-message" role="status">Finding places…</div>}
                {!searching && searchError && <div className="search-message" role="status">{searchError}</div>}
                {!searching && !searchError && suggestions.length === 0 && <div className="search-message" role="status">No places found. Try another city.</div>}
                {suggestions.map((result, index) => <button className="suggestion" key={`${result.id}-${result.latitude}`} onMouseDown={(event) => event.preventDefault()} onClick={() => choosePlace(result)} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.parentElement?.querySelectorAll('.suggestion')[index + 1]?.focus(); } if (event.key === 'ArrowUp') { event.preventDefault(); if (index > 0) event.currentTarget.parentElement?.querySelectorAll('.suggestion')[index - 1]?.focus(); else searchRef.current?.querySelector('input')?.focus(); } }}><MapPin size={16} /><span><strong>{result.name}</strong><small>{[result.admin1, result.country].filter(Boolean).join(', ')}</small></span><ChevronRight size={15} /></button>)}
              </motion.div>}</AnimatePresence>
            </div>
            <button className="icon-button location-button" title="Use my current location" aria-label="Use my current location" onClick={detectLocation}><LocateFixed size={18} /></button>
            <button className="icon-button refresh-button" title="Refresh weather" aria-label="Refresh weather" disabled={!weather || loading} onClick={() => loadWeather(place)}><RefreshCw size={16} /></button>
            <div className="unit-toggle top-unit" role="group" aria-label="Temperature unit"><button aria-pressed={unit === 'C'} className={unit === 'C' ? 'selected' : ''} onClick={() => setUnit('C')}>°C</button><button aria-pressed={unit === 'F'} className={unit === 'F' ? 'selected' : ''} onClick={() => setUnit('F')}>°F</button></div>
            <button className="profile-avatar" title={session?.user?.email || 'Sign in to sync your dashboard'} aria-label={session ? `Manage account for ${session.user.email}` : 'Sign in to sync your dashboard'} onClick={() => { setAuthError(''); setAuthOpen(true); }}>{session?.user?.email?.slice(0, 1).toUpperCase() || place.name.slice(0, 1).toUpperCase()}</button>
          </div>
          {(activeNav === 'Overview' || activeNav === 'Forecast') && current && <div className="topbar-place-summary">
            <div><strong>{weatherDescription(activeCode).label}</strong><span>{[place.admin1, place.country].filter(Boolean).join(', ')}</span></div>
            <strong className="topbar-place-temperature">{round(convertTemp(current.temperature_2m, unit))}°{unit}</strong>
          </div>}
        </header>

        <div className="content-wrap">
          {error && <div className="error-banner" role="alert"><span>{error}</span>{retryPlace && <button onClick={() => loadWeather(retryPlace, { navigate: retryNavigates })}>Try again <ChevronRight size={14} /></button>}<button aria-label="Dismiss error" onClick={() => { setError(''); setRetryPlace(null); }}><X size={16} /></button></div>}
          {activeNav === 'Favorites' ? renderFavorites() : activeNav === 'Weather map' ? renderMap() : activeNav === 'Air quality' ? renderAirQuality() : activeNav === 'Settings' ? renderSettings() :
            <div className="dashboard-page editorial-dashboard">
              {rainSoon && weather && <div className="insight-banner" role="status">
                <span className="insight-icon"><CloudRain size={17} /></span>
                <p><strong>Rain likely around {rainSoon.label.toLowerCase()}</strong> — {rainSoon.rain}% chance within the next few hours. Grab an umbrella.</p>
              </div>}
              {advisoryChips.length > 0 && weather && <div className="advisory-chips" role="list">
                {advisoryChips.map(({ icon: Icon, text }) => <span className="advisory-chip" role="listitem" key={text}><Icon size={13} />{text}</span>)}
              </div>}
              {loading && !weather ? <div className="loading-splash"><img src="/tomorrow-rain.gif" alt="" aria-hidden="true" /><span role="status">Loading forecast…</span></div> : !loading && !weather ? <div className="weather-unavailable panel">
                <span className="weather-unavailable-icon"><Cloud size={23} /></span>
                <h2>Forecast temporarily unavailable</h2>
                <p>The weather provider didn’t respond after a few attempts. Check your connection and try again.</p>
                {retryPlace && <button className="button-primary" onClick={() => loadWeather(retryPlace, { navigate: retryNavigates })}><RefreshCw size={14} /> Try again</button>}
              </div> : weather && <>
                <div className="editorial-layout">
                  <div className="editorial-main-column">
                    <section className="editorial-feature-grid">
                      <article className={`weather-highlight video-active${isDay ? '' : ' night-active'}`}>
                        <picture className="weather-video"><source media="(prefers-reduced-motion: reduce)" srcSet={weatherScene.poster} /><img src={weatherScene.animation} alt="" aria-hidden="true" /></picture>
                        <div className="highlight-heading">
                          <span className="highlight-icon"><WeatherIcon code={activeCode} size={19} /></span>
                          <div><strong>Weather</strong><span>{weatherDescription(activeCode).label} in {place.name}</span></div>
                          <button className={`editorial-save${isFavorite ? ' saved' : ''}`} aria-label={isFavorite ? 'Remove saved location' : 'Save location'} title={isFavorite ? 'Remove saved location' : 'Save location'} aria-pressed={isFavorite} onClick={toggleFavorite}><Bookmark size={16} fill={isFavorite ? 'currentColor' : 'none'} /></button>
                        </div>
                        <div className="weather-highlight-reading">
                          <strong>{round(convertTemp(current.temperature_2m, unit))}°{unit}</strong>
                          <span>{weatherDescription(activeCode).label}</span>
                          <small>Feels like {round(convertTemp(current.apparent_temperature, unit))}°</small>
                        </div>
                        <div className="weather-highlight-metrics">
                          <div><span>Pressure</span><strong>{round(current.pressure_msl)} <small>hPa</small></strong></div>
                          <div><span>Visibility</span><strong>{round(current.visibility / 1000)} <small>km</small></strong></div>
                          <div><span>Humidity</span><strong>{round(current.relative_humidity_2m)}<small>%</small></strong></div>
                        </div>
                      </article>

                      <article className="air-highlight">
                        <AirIllustration />
                        <div className="highlight-heading">
                          <span className="highlight-icon"><Activity size={18} /></span>
                          <div><strong>Air quality</strong><span>US AQI estimate · PM2.5</span></div>
                          <button className="air-more" aria-label="Explore air quality" onClick={() => setActiveNav('Air quality')}><ChevronRight size={17} /></button>
                        </div>
                        <div className="air-highlight-reading">
                          <strong>{aqi == null ? '—' : round(aqi)}</strong>
                          <span>US AQI</span>
                          <small>{airStatus.label}</small>
                        </div>
                        <div className="air-scale">
                          <div className="air-scale-labels"><span>Good</span><span>Moderate</span><span>Unhealthy</span></div>
                          <div className="air-meter"><i style={{ width: `${Math.min((aqi || 0) / 300 * 100, 100)}%`, background: airStatus.color }} /></div>
                          <span className="air-pm">PM2.5 <strong>{airNow?.pm2_5 == null ? '—' : `${Number(airNow.pm2_5).toFixed(1)} μg/m³`}</strong></span>
                        </div>
                      </article>
                    </section>

                    <section className="editorial-lower-grid">
                      <article className="temperature-panel">
                        <div className="temperature-heading">
                          <div><span className="eyebrow">TODAY, BY THE HOUR</span><h2>How's the temperature today?</h2></div>
                          <div className="temperature-key"><span /><small>Temperature</small></div>
                        </div>
                        <div className="timeline-chart">
                          <svg viewBox="0 0 400 112" preserveAspectRatio="none" role="img" aria-label="Hourly temperature trend">
                            <path className="timeline-baseline" d="M25 92H372" />
                            {timelinePath && <path className="timeline-line" d={timelinePath} />}
                            {timeline.map((hour, index) => {
                              const x = timeline.length === 1 ? 200 : 28 + index * (344 / (timeline.length - 1));
                              const y = 76 - ((hour.temp - timelineLow) / timelineRange) * 43;
                              return <circle key={hour.time} className="timeline-point" cx={x} cy={y} r={index === 1 ? 4 : 3} />;
                            })}
                          </svg>
                        </div>
                        <div className="timeline-hours">
                          {timeline.map((hour) => <div className="timeline-hour" key={hour.time}>
                            <span className="timeline-weather-icon"><WeatherIcon code={hour.code} size={18} /></span>
                            <strong>{round(convertTemp(hour.temp, unit))}°</strong>
                            <small>{hour.period}</small>
                          </div>)}
                        </div>
                      </article>

                      <article className={`tomorrow-card animated${tomorrowIsRainy ? ' rainy' : ''}`}>
                        <div className="tomorrow-copy">
                          <span className="eyebrow">TOMORROW</span>
                          <h2>{daily.time?.[1] ? new Date(`${daily.time[1]}T12:00:00`).toLocaleDateString([], { weekday: 'long' }) : 'Tomorrow'}</h2>
                          <strong>{round(convertTemp(daily.temperature_2m_max[1], unit))}°{unit}</strong>
                          <span>{weatherDescription(daily.weather_code[1]).label}</span>
                          <small>Low {round(convertTemp(daily.temperature_2m_min[1], unit))}°</small>
                        </div>
                        <img
  className="tomorrow-weather-video"
  src={publicAsset(tomorrowIsRainy ? 'tomorrow-rain.gif' : 'tomorrow-walk.gif')}
  alt=""
  aria-hidden="true"
/>
                        <TomorrowIllustration mood={tomorrowMood} />
                      </article>
                    </section>

                    {activeNav === 'Forecast' && <>
                      <section className="editorial-details" aria-label="More weather details">
                        <div><Wind size={17} /><span>Wind</span><strong>{round(convertWind(current.wind_speed_10m, windUnit))} {windUnit} {windDirection(current.wind_direction_10m).replace(' wind', '')}</strong></div>
                        <div><Cloud size={17} /><span>Cloud cover</span><strong>{round(current.cloud_cover)}%</strong></div>
                        <div><Thermometer size={17} /><span>Dew point</span><strong>{round(convertTemp(current.dew_point_2m, unit))}°{unit}</strong></div>
                        <div><Droplets size={17} /><span>Precipitation</span><strong>{Number(precipUnit === 'in' ? current.precipitation / 25.4 : current.precipitation).toFixed(precipUnit === 'in' ? 2 : 1)} {precipUnit}</strong></div>
                      </section>

                      <section ref={forecastRef} id="forecast-details" className="panel analytics-panel" tabIndex={-1} aria-label="Detailed weather forecast">
                        <div className="section-title-row">
                          <div><span className="eyebrow">WEATHER ANALYTICS</span><h2>{chartMode === 'week' ? '7-day temperature range' : chartMode === 'precipitation' ? 'Chance of precipitation' : chartMode === 'wind' ? 'Wind speed, by the hour' : 'Today, by the hour'}</h2></div>
                          <div className="chart-controls" role="group" aria-label="Weather chart type">
                            {[['temperature', 'Temp'], ['precipitation', 'Rain'], ['wind', 'Wind'], ['week', '7 days']].map(([mode, label]) => <button key={mode} aria-pressed={chartMode === mode} className={chartMode === mode ? 'selected' : ''} onClick={() => setChartMode(mode)}>{label}</button>)}
                          </div>
                        </div>
                        <Suspense fallback={<div className="chart-area loading-chart" />}>
                          <TemperatureChart data={chartMode === 'week' ? dailyChartData : chartData} mode={chartMode} unit={unit} windUnit={windUnit} />
                        </Suspense>
                      </section>
                    </>}

                    {activeNav === 'Forecast' && <section className="panel extended-forecast"><div className="section-title-row"><div><span className="eyebrow">A FULL WEEK, AT A GLANCE</span><h2>7-day outlook</h2></div><span className="muted">Rain chance · Daily high & low</span></div><div className="extended-days">{daily.time.map((date, index) => <div className="extended-day" key={date}><span>{index === 0 ? 'Today' : weekday(date)}</span><WeatherIcon code={daily.weather_code[index]} size={24} /><strong>{round(convertTemp(daily.temperature_2m_max[index], unit))}°</strong><span>{round(convertTemp(daily.temperature_2m_min[index], unit))}°</span><small><Droplets size={12} />{daily.precipitation_probability_max[index] ?? 0}%</small></div>)}</div></section>}
                  </div>

                  <aside className="editorial-aside">
                    <section className="sun-panel">
                      <div className="sun-panel-heading"><div><strong>{weatherDescription(activeCode).label}</strong><span>{place.name}{place.country ? `, ${place.country}` : ''}</span></div><strong className="sun-panel-temp">{round(convertTemp(current.temperature_2m, unit))}°{unit}</strong></div>
                      <div className="sun-arc">
                        <span className="sun-arc-icon">{current.is_day === 1 ? <Sun size={17} /> : <Moon size={16} />}</span>
                        <span className="sun-arc-position" style={{ left: `${10 + daylightProgress * 80}%`, bottom: `${10 + Math.sin(daylightProgress * Math.PI) * 54}px` }} />
                        <svg viewBox="0 0 240 110" preserveAspectRatio="none" aria-hidden="true"><path d="M12 94 A108 83 0 0 1 228 94" /></svg>
                      </div>
                      <div className="sun-times"><div><strong>Sunrise</strong><span>{formatClock(daily.sunrise[0])}</span></div><i /><div><strong>Sunset</strong><span>{formatClock(daily.sunset[0])}</span></div></div>
                    </section>

                    <section className="uv-panel" aria-label="Today's maximum ultraviolet index">
                      <span className="uv-sun"><Sun size={22} /></span>
                      <div><span>Today’s max</span><strong>{Number(daily.uv_index_max[0]).toFixed(0)} <small>UVI</small></strong><span>{uvDescription(daily.uv_index_max[0])}</span><small>Protection is advised from UVI 3.</small></div>
                      <span className="uv-badge">{daily.uv_index_max[0] < 3 ? 'Low' : daily.uv_index_max[0] < 6 ? 'Moderate' : daily.uv_index_max[0] < 8 ? 'High' : 'Very high'}</span>
                    </section>

                    <section className="prediction-panel">
                      <div className="prediction-heading"><h2>Weather prediction</h2><span>Next days</span></div>
                      <div className="prediction-list">
                        {daily.time.slice(1, 3).map((date, index) => {
                          const dayIndex = index + 1;
                          return <div className="prediction-day" key={date}>
                            <WeatherIcon code={daily.weather_code[dayIndex]} size={22} />
                            <div><span>{new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'long', day: 'numeric' })}</span><strong>{weatherDescription(daily.weather_code[dayIndex]).label}</strong></div>
                            <b>{round(convertTemp(daily.temperature_2m_max[dayIndex], unit))}° <small>/ {round(convertTemp(daily.temperature_2m_min[dayIndex], unit))}°</small></b>
                          </div>;
                        })}
                      </div>
                      <button className="forecast-more" onClick={() => setActiveNav('Forecast')}><Sun size={13} /> Next 5 days <ChevronRight size={14} /></button>
                    </section>
                  </aside>
                </div>
              </>}
            </div>}
          {loading && pendingPlace && <div className="refresh-indicator" role="status"><span />{!weather || pendingPlace.latitude !== place.latitude || pendingPlace.longitude !== place.longitude ? `Loading forecast for ${pendingPlace.name}…` : 'Refreshing forecast…'}</div>}
          {freshness && weather && <span className="freshness-pill" role="status">{freshness}</span>}
          <footer className="source-disclosure">
            <span>Model-based weather and air-quality data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo</a>, retrieved when shown and refreshed about every 15 minutes.</span>
            <span>{weatherFetchedAt ? `${weatherIsStale ? 'Showing saved forecast · ' : ''}Last retrieved at ${formatUpdatedTime(weatherFetchedAt, weather?.timezone)} local time.` : loading ? 'Weather data is loading.' : 'No forecast is available yet.'} Map imagery, radar, and hazard feeds have varying coverage and update times; model overlays are estimates, not official severe-weather alerts. Check your local weather authority for warnings.</span>
          </footer>
        </div>
      </main>
      {authOpen && <div className="auth-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setAuthOpen(false); }}>
        <section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-dialog-title">
          <button className="auth-close icon-button" aria-label="Close account dialog" onClick={() => setAuthOpen(false)}><X size={18} /></button>
          <div className="auth-mark"><Sun size={22} /></div>
          {session ? <>
            <span className="eyebrow">YOUR SKYLINE ACCOUNT</span>
            <h2 id="auth-dialog-title">Dashboard sync</h2>
            <p className="auth-description">Signed in as <strong>{session.user.email}</strong></p>
            <div className={`auth-sync-status${syncStatus === 'error' ? ' has-error' : ''}`} role={syncStatus === 'error' ? 'alert' : 'status'}>
              {syncStatus === 'loading' ? 'Loading your dashboard…' : syncStatus === 'saving' ? 'Syncing your changes…' : syncStatus === 'error' ? 'Dashboard sync needs attention.' : 'Your favorites and preferences are synced.'}
            </div>
            {authError && <p className="auth-error" role="alert">{authError}</p>}
            <button className="auth-signout" onClick={signOut}><LogOut size={16} /> Sign out</button>
          </> : <>
            <span className="eyebrow">SAVE YOUR SKYLINE</span>
            <h2 id="auth-dialog-title">Sign in to sync your dashboard</h2>
            <p className="auth-description">Keep your saved places, recent searches, selected location, and preferences across devices.</p>
            <button className="auth-provider auth-provider-google" disabled={!isSupabaseConfigured || authLoading} onClick={() => signInWithProvider('google')}><span className="google-mark" aria-hidden="true">G</span>Continue with Google</button>
            <button className="auth-provider auth-provider-facebook" disabled={!isSupabaseConfigured || authLoading} onClick={() => signInWithProvider('facebook')}><Facebook size={18} fill="currentColor" />Continue with Facebook</button>
            {!isSupabaseConfigured && <p className="auth-setup-note">Sign-in setup is required. Add your Supabase project URL and publishable key to <code>.env</code>, configure Google and Facebook under Supabase Authentication, then restart the app.</p>}
            {authLoading && <p className="auth-setup-note" role="status">Checking your sign-in session…</p>}
            {authError && <p className="auth-error" role="alert">{authError}</p>}
            <p className="auth-privacy-note">Your dashboard data is private to your account.</p>
          </>}
        </section>
      </div>}
      <AnimatePresence>{notice && <motion.div className="toast" role="status" initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ duration: reducedMotion ? 0 : 0.18 }}><Check size={16} />{notice}</motion.div>}</AnimatePresence>
    </div>
  );
}

function SectionHeading({ eyebrow, title, subtitle }) {
  return <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}<span className="heading-period">.</span></h1><p>{subtitle}</p></div>;
}

function convertTemp(value, unit) {
  return unit === 'F' ? value * 9 / 5 + 32 : value;
}

function convertWind(value, unit) {
  return unit === 'mph' ? value * 0.621371 : value;
}

function windDirection(degrees) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return `${directions[Math.round(degrees / 45) % 8]} wind`;
}

function uvDescription(value) {
  if (value < 3) return 'Low exposure';
  if (value < 6) return 'Moderate exposure';
  if (value < 8) return 'High exposure';
  if (value < 11) return 'Very high exposure';
  return 'Extreme exposure';
}

export default App;
