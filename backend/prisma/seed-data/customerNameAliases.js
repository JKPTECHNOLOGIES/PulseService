// Other CSV exports (quotes.csv, jobs.csv, ...) reference customers by the
// ORIGINAL per-property name from the customers export, before dedup. These
// names were removed during customer dedup (same address, different/suffixed
// name -> kept one base customer — see customerMerges.js / PR history for the
// full reasoning), so rows referencing them need to be re-pointed at whichever
// customer we kept. Shared by every importer in seed.js via customerByRawName.
module.exports = {
  "6767 N Ocean Blvd. - 1010": "6767 N Ocean Blvd.",
  "Ballenisles CC-Cult, Mem Lge, Rac Cntr": "Ballenisles Country Club-Main",
  "Ballenisles CC-SE Crse, Golf Lrn/Resrms": "Ballenisles Country Club-Main",
  "Ballenisles CC-Sports/Pool Bldg": "Ballenisles Country Club-Main",
  "Fox Timothy - 1004": "Fox Timothy",
  "Frenchman's  Hole # 5- 1001": "Frenchman's Reserve Country Club",
  "Frenchman's Reserve Ladies  - 1011": "Frenchman's Reserve Country Club",
  "Haney Residence - 1009": "Haney Residence",
  "Malave, Jesus & Janine - 1003": "Malave, Jesus & Janine",
  "Narr, George & Christine - 1008": "Narr, George & Christine",
  "ROONEY 2-1 TON MINI SPLIT SYSTEMS- 1002": "Lamontagne, Richard",
  "Savoy Residence - 1000": "Savoy Residence",
  "Slatter, Danielle - 1006": "Slatter, Danielle",
  "SS Palm Beach, LLC - 1005": "SS Palm Beach, LLC",
  "SS Palm Beach, LLC - 1007": "SS Palm Beach, LLC",
  "SS Palm Beach, LLC - 1013": "SS Palm Beach, LLC",
  "The Sailfish Club of Florida - 1012": "The Sailfish Club of Florida",
  "Thornton, John & Margaret-Water Tower": "Thornton, John & Margaret-A/C",
  "Webster, Jeff & Marion - 1016": "Webster, Jeff & Marion",
};
