// Exchange rates for display only. Prices from distributors and the demo catalog are in USD;
// the page can show them in MXN or EUR at the European Central Bank reference rate, which
// Frankfurter (https://frankfurter.dev, no key) publishes once per working day. The Worker fetches
// and caches the rate (GET /fx), so the page itself calls no third-party API.
// Pure logic, no DOM, so tests can run it in Node and the Worker can import it.

export const FX_URL = "https://api.frankfurter.dev/v1/latest?base=USD&symbols=MXN,EUR";
export const FX_SOURCE = "European Central Bank reference rate, via Frankfurter";

export const CURRENCIES = {
  USD: {symbol: "US$", name: "US dollar"},
  MXN: {symbol: "MX$", name: "Mexican peso"},
  EUR: {symbol: "€",   name: "Euro"}
};

// Frankfurter answers {amount:1, base:"USD", date:"2026-11-05", rates:{EUR:0.89, MXN:18.59}}.
// Returns {date, perUsd:{USD:1, MXN, EUR}}, or null if anything is missing or implausible,
// so a bad answer never turns into a wrong price.
export function parseRates(json){
  if (!json || json.base !== "USD" || typeof json.rates !== "object" || json.rates === null) return null;
  if (typeof json.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(json.date)) return null;
  const amount = json.amount ?? 1;
  if (!(amount > 0)) return null;
  const perUsd = {USD: 1};
  for (const cur of ["MXN", "EUR"]){
    const r = json.rates[cur] / amount;
    if (!Number.isFinite(r) || r <= 0) return null;
    perUsd[cur] = r;
  }
  return {date: json.date, perUsd};
}
