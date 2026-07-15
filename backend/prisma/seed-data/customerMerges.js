// Manually-identified multi-property customers. The source export
// (customers.csv) has one row per property/job, but each group below is the
// SAME real customer serviced at more than one address — so instead of
// creating a duplicate Customer per row, these become one Customer with
// multiple Locations. Matched by exact "Full Address" text (unique per row
// in the source file). See the chat history / PR description for how each
// group was identified (shared phone+email, or in Burckle's case, name-only
// match across two otherwise-unrelated contact records).
module.exports = [
  {
    key: "blood-donald-erin",
    firstName: "Donald & Erin",
    lastName: "Blood",
    type: "residential",
    phone: "5612360061",
    email: "donaldblood@yahoo.com",
    source: "Referral",
    addresses: [
      "217 N Palmway - Lake Worth FL 33460",
      "316 N Ocean Breeze Street - Lake Worth FL 33460",
    ],
  },
  {
    key: "czerw-rob",
    firstName: "Rob",
    lastName: "Czerw",
    type: "residential",
    phone: "5612523952",
    email: "rob.czerw@yahoo.com",
    source: "Referral",
    addresses: [
      "115 Elena Court - Jupiter FL 33478",
      "4202 Water Oak Court - Palm Beach Gardens FL 33410",
    ],
  },
  {
    key: "labetti-denise",
    firstName: "Denise",
    lastName: "Labetti",
    type: "residential",
    phone: "5614937128",
    email: "deniselabetti@yahoo.com",
    source: "Existing Customer",
    addresses: [
      "100 Paradise Harbour Blvd - North Palm Beach FL 33408",
      "105 Paradise Harbour Blvd - North Palm Beach FL 33408",
    ],
  },
  {
    key: "fischbein",
    firstName: "",
    lastName: "Fischbein",
    type: "residential",
    phone: "5612227250",
    email: "karnowitt@oldmarshgolf.com",
    source: "Existing Customer",
    addresses: [
      "12781 Marsh Landing - Palm Beach Gardens FL 33418",
      "12801 Marsh Landing - Palm Beach Gardens FL 33418",
    ],
  },
  {
    // Two rows shared the same real person's name but had different contact
    // info on file per property; kept the personal email over the shared
    // Old Marsh HOA management email, and the real phone over the other row.
    key: "burckle-chris-jill",
    firstName: "Chris & Jill",
    lastName: "Burckle",
    type: "residential",
    phone: "5612227250",
    email: "cburckle@aol.com",
    source: "Existing Customer",
    addresses: [
      "6 Tarrington Cirlce - Palm Beach Gardens FL 33418",
      "13360 Marsh Landing - Palm Beach Gardens FL 33418",
    ],
  },
  {
    key: "sailfish-club",
    firstName: "The Sailfish Club of",
    lastName: "Florida",
    companyName: "The Sailfish Club of Florida",
    type: "commercial",
    phone: "5618440206",
    email: "janebess@sailfishclub.com",
    source: "Existing Customer",
    addresses: [
      "1338 N Lake Way - Palm Beach FL 33480",
      "2727 Rosemary Ave Suite 14 & 15 - West Palm Beach FL 33480",
    ],
  },
];
