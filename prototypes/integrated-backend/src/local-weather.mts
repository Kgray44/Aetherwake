import { execFile } from "node:child_process";
import { promisify } from "node:util";

export type WeatherPeriod = "now" | "today" | "tonight" | "tomorrow" | "tomorrow-morning";
type Location = { latitude: number; longitude: number };
const execute = promisify(execFile);
const origin = "https://api.weather.gov";

async function deviceLocation(signal: AbortSignal): Promise<Location> {
  // Ask the Windows location provider once. TryStart's first argument keeps
  // the helper from opening a permission prompt behind the reviewing window.
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Device
$watcher = [System.Device.Location.GeoCoordinateWatcher]::new()
try {
  if (!$watcher.TryStart($true, [TimeSpan]::FromSeconds(5))) { exit 2 }
  $fix = $watcher.Position
  $point = $fix.Location
  if ($watcher.Permission -ne 'Granted' -or $point.IsUnknown -or
      ([DateTimeOffset]::UtcNow - $fix.Timestamp).TotalMinutes -gt 15) { exit 2 }
  @{ latitude = $point.Latitude; longitude = $point.Longitude } | ConvertTo-Json -Compress
} finally { $watcher.Dispose() }
`;
  const { stdout } = await execute("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command", script,
  ], { windowsHide: true, timeout: 7500, maxBuffer: 2048, signal });
  return JSON.parse(stdout) as Location;
}

async function json(url: string, signal: AbortSignal, request: typeof fetch) {
  const response = await request(url, {
    signal, redirect: "error",
    headers: { Accept: "application/geo+json", "User-Agent": "Aerynth desktop (github.com/Kgray44/Aetherwake)" },
  });
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw Error("weather_source_unavailable");
  }
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let body = "", bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) return JSON.parse(body + decoder.decode());
      bytes += part.value.byteLength;
      if (bytes > 1024 * 1024) throw Error("weather_source_capacity");
      body += decoder.decode(part.value, { stream: true });
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function boundedText(value: unknown, max = 120) {
  return typeof value === "string" && value.length <= max && !/[\x00-\x1f]/.test(value)
    ? value.trim() : "";
}

/** Device coordinates stay in the native process. Only a rounded point is
 * shared with the fixed forecast origin after the caller's one-time review. */
export async function readLocalWeather(period: WeatherPeriod, cancel: AbortSignal, options: {
  locate?: typeof deviceLocation; request?: typeof fetch; now?: () => Date;
} = {}): Promise<{ content: string; ok: boolean }> {
  const signal = AbortSignal.any([cancel, AbortSignal.timeout(16000)]);
  let point: Location;
  try {
    point = await (options.locate ?? deviceLocation)(signal);
    if (!Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 ||
        !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180)
      throw Error("invalid_device_location");
  } catch {
    cancel.throwIfAborted();
    return { ok: false, content: "Windows did not provide a current location. Check Location services and desktop app access in Windows Settings." };
  }
  try {
    const request = options.request ?? fetch;
    const properties = (await json(origin + "/points/" +
      point.latitude.toFixed(2) + "," + point.longitude.toFixed(2), signal, request)).properties;
    const hourly = period === "now" || period === "tomorrow-morning";
    const forecast = new URL(hourly ? properties.forecastHourly : properties.forecast);
    if (forecast.origin !== origin || forecast.username || forecast.password ||
        forecast.search || forecast.hash ||
        !/^\/gridpoints\/[A-Z]{3}\/\d+,\d+\/forecast(?:\/hourly)?$/.test(forecast.pathname))
      throw Error("invalid_weather_source");
    const payload = await json(forecast.href, signal, request);
    const now = (options.now ?? (() => new Date()))();
    const zone = properties.timeZone;
    if (typeof zone !== "string" || !zone) throw Error("invalid_weather_time_zone");
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    });
    const hour = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", hourCycle: "h23" });
    const today = date.format(now);
    const day = new Date(today + "T12:00:00Z");
    day.setUTCDate(day.getUTCDate() + 1);
    const tomorrow = day.toISOString().slice(0, 10);
    type Slot = { startTime: string; endTime: string; isDaytime: boolean; shortForecast: string;
      temperature: number; temperatureUnit: string; probabilityOfPrecipitation?: { value?: number } };
    const slots: Slot[] = Array.isArray(payload.properties?.periods) ? payload.properties.periods : [];
    const matching = slots.filter((slot) => {
      const start = new Date(slot.startTime), end = new Date(slot.endTime);
      if (!Number.isFinite(start.getTime()) || !(end > now) || !Number.isFinite(slot.temperature) ||
          !["F", "C"].includes(slot.temperatureUnit) || !boundedText(slot.shortForecast)) return false;
      if (period === "now") return start <= now;
      if (period === "today") return date.format(start) === today && slot.isDaytime;
      if (period === "tonight") return !slot.isDaytime && date.format(start) === today;
      if (date.format(start) !== tomorrow) return false;
      return period === "tomorrow" ? slot.isDaytime : Number(hour.format(start)) >= 6 && Number(hour.format(start)) < 12;
    });
    const selected = period === "tomorrow-morning" ? matching.slice(0, 6) : matching.slice(0, 1);
    const first = selected[0];
    if (!first) throw Error("requested_weather_period_unavailable");
    const min = Math.min(...selected.map(slot => slot.temperature)), max = Math.max(...selected.map(slot => slot.temperature));
    const precipitation = selected.flatMap(slot => {
      const chance = slot.probabilityOfPrecipitation?.value;
      return typeof chance === "number" && Number.isFinite(chance) && chance >= 0 && chance <= 100 ? [chance] : [];
    });
    const relative = properties.relativeLocation?.properties;
    const place = [boundedText(relative?.city, 80), boundedText(relative?.state, 10)].filter(Boolean).join(", ");
    const label = { now: "Current hour forecast", today: "Today", tonight: "Tonight", tomorrow: "Tomorrow", "tomorrow-morning": "Tomorrow morning" }[period];
    const conditions = [...new Set(selected.map(slot => boundedText(slot.shortForecast)))].slice(0, 2).join(" / ");
    const temperature = (min === max ? String(min) : min + "–" + max) + "°" + first.temperatureUnit;
    return { ok: true, content: label + (place ? " near " + place : "") + " — " + conditions +
      ", " + temperature + (precipitation.length ? ", " + Math.max(...precipitation) + "% chance of precipitation" : "") +
      ".\nSource: National Weather Service." };
  } catch {
    cancel.throwIfAborted();
    return { ok: false, content: "The National Weather Service could not provide that forecast for this location or time." };
  }
}
