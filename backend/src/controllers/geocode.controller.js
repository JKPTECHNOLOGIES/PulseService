const prisma = require("../config/database");
const { geocode } = require("../services/geocode.service");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Geocodes customer locations that are missing coordinates so they appear on
// the map. Rate-limited to respect Nominatim's ~1 request/second policy.
const backfill = async (req, res) => {
  try {
    const locations = await prisma.location.findMany({
      where: { OR: [{ lat: null }, { lng: null }] },
      take: 40,
    });

    let updated = 0;
    for (const loc of locations) {
      const address = [loc.address, loc.city, loc.state, loc.zip]
        .filter(Boolean)
        .join(", ");
      const geo = await geocode(address);
      if (geo) {
        await prisma.location.update({
          where: { id: loc.id },
          data: { lat: geo.lat, lng: geo.lng },
        });
        updated += 1;
      }
      await sleep(1100);
    }

    return res.json({
      success: true,
      data: { scanned: locations.length, updated },
    });
  } catch (err) {
    console.error("geocode.backfill error:", err);
    return res.status(500).json({ success: false, error: "Server error" });
  }
};

module.exports = { backfill };
