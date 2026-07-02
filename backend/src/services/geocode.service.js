// Best-effort forward geocoding via OpenStreetMap Nominatim (no API key). Used
// to populate Location lat/lng so jobs can be plotted on the map. Returns null
// on any failure — callers must treat coordinates as optional.
async function geocode(address) {
  if (!address) return null;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(
      address,
    )}`;
    const res = await fetch(url, {
      signal: controller.signal,
      // Nominatim requires an identifying User-Agent.
      headers: { "User-Agent": "PulseService/1.0 (field-service-management)" },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

module.exports = { geocode };
