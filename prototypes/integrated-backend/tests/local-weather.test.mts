import test from "node:test";
import assert from "node:assert/strict";
import { readLocalWeather } from "../src/local-weather.mts";

const signal = new AbortController().signal;
const locate = async (input:{requestedAtMs:number}) => ({ latitude: 43.45827, longitude: -72.38753,observedAtMs:input.requestedAtMs,source:'wifi' as const });
const now = () => new Date("2026-11-03T06:00:00Z");
const origin = "https://api.weather.gov";
const forecast = origin + "/gridpoints/BTV/100,30/forecast/hourly";
const point = {
  timeZone: "America/New_York", forecastHourly: forecast,
  relativeLocation: { properties: { city: "Example", state: "VT" } },
};

test("local forecast sends rounded coordinates and reports only the requested local hours", async () => {
  const requests: string[] = [];
  const request: typeof fetch = async (url, options) => {
    requests.push(String(url));
    assert.equal(options?.redirect, "error");
    if (requests.length === 1) return Response.json({ properties: point });
    const slot = (hour: string, temperature: number, chance: number) => ({
      startTime: `2026-11-04T${hour}:00:00-05:00`, endTime: "2026-11-04T23:00:00-05:00",
      isDaytime: true, shortForecast: "Cloudy", temperature, temperatureUnit: "F",
      probabilityOfPrecipitation: { value: chance },
    });
    return Response.json({ properties: { periods: [slot("05", 20, 100), slot("06", 35, 20), slot("11", 43, 35), slot("12", 49, 90)] } });
  };
  const result = await readLocalWeather("tomorrow-morning", signal, { locate, request, now });
  assert.deepEqual(requests, [origin + "/points/43.46,-72.39", forecast]);
  assert.equal(result.ok, true);
  assert.match(result.content, /Tomorrow morning near Example, VT — Cloudy, 35–43°F, 35% chance/);
  assert.doesNotMatch(result.content, /43\.46|-72\.39/);
});

test("denied location makes no network request and untrusted forecast destinations are rejected", async () => {
  let requests = 0;
  const request: typeof fetch = async () => {
    requests++;
    return Response.json({ properties: { ...point, forecastHourly: "https://example.invalid/forecast" } });
  };
  const denied = await readLocalWeather("now", signal, {
    locate: async () => { throw Error("denied"); }, request, now,
  });
  assert.match(denied.content, /Windows did not provide/);
  assert.equal(requests, 0);
  assert.equal((await readLocalWeather("now", signal, { locate, request, now })).ok, false);
  assert.equal(requests, 1);
});
