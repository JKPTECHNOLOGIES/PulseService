// FieldEdge let staff add multiple separate customer records under one
// "primary" customer (visually shown as indented rows with a small icon in
// the FieldEdge UI -- not present in the flat CSV export at all). Each row
// below is still its own full Customer (own number, own jobs/invoices/quotes)
// -- this is a REFERENCE from secondary -> primary, not a merge. Manually
// transcribed from the client's FieldEdge customer list (2026-07-24) since
// the export itself carries no parent/child column.
//
// Entries are normally just the "Display Name" string. A couple of names
// aren't unique in the source file (two rows literally named "Czerw, Rob"),
// so those use `{ name, address }` to disambiguate by the row's exact "Full
// Address" instead.
module.exports = [
  {
    primary: "6767 N Ocean Blvd.",
    secondaries: ["6767 N Ocean Blvd. - 1010"],
  },
  {
    primary: "Ashbritt Inc",
    secondaries: ["1141", "1171"],
  },
  {
    primary: "Ballenisles Country Club-Main",
    secondaries: [
      "Ballenisles CC-Cult, Mem Lge, Rac Cntr",
      "Ballenisles CC-SE Crse, Golf Lrn/Resrms",
      "Ballenisles CC-Sports/Pool Bldg",
    ],
  },
  {
    primary: "Belanger Steve",
    secondaries: ["Belanger, Steve-Rental"],
  },
  {
    // "Blood, Donald & Erin" and "Blood Donald & Erin" normalize to the same
    // key (comma-insensitive matching) -- disambiguate by address like Czerw.
    primary: {
      name: "Blood, Donald & Erin",
      address: "217 N Palmway - Lake Worth FL 33460",
    },
    secondaries: [
      {
        name: "Blood Donald & Erin",
        address: "316 N Ocean Breeze Street - Lake Worth FL 33460",
      },
    ],
  },
  {
    // Both rows are literally named "Czerw, Rob" -- disambiguate by address.
    primary: {
      name: "Czerw, Rob",
      address: "115 Elena Court - Jupiter FL 33478",
    },
    secondaries: [
      {
        name: "Czerw, Rob",
        address: "4202 Water Oak Court - Palm Beach Gardens FL 33410",
      },
    ],
  },
  {
    primary: "Ennis Dr. Scott - Off 233",
    secondaries: ["Ennis Dr. Scott -Res 1889"],
  },
  {
    primary: "Fox Timothy",
    secondaries: ["Fox Timothy - 1004"],
  },
  {
    primary: "Frenchman's Reserve Country Club",
    secondaries: [
      "Frenchman's  Hole # 5- 1001",
      "Frenchman's Reserve Ladies  - 1011",
    ],
  },
  {
    primary: "HOSHISAKI AMERICA-Warr",
    secondaries: ["Loxahatchee Warr"],
  },
  {
    primary: "Lamontagne, Richard",
    secondaries: ["ROONEY 2-1 TON MINI SPLIT SYSTEMS- 1002"],
  },
  {
    primary: "Livingston Builders, Inc.",
    secondaries: ["1236 S Ocean Blvd-Thornton"],
  },
  {
    primary: "Narr, George & Christine",
    secondaries: ["Narr, George & Christine - 1008"],
  },
  {
    primary: "Old Marsh Homeowners Association",
    secondaries: [
      "Bland, Jeffery",
      "Braniff, John & Rosemary",
      "Burckle, Chris & Jill",
      "Costantino, David & Ann Marie",
      "Dunfee David",
      "Dwyer Residence",
      "Fischbein-12781",
      "Fischbein-12801",
      "Fletcher Ralph",
      "Lucarelli, Donald & Barbara",
      "Malave, Jesus & Janine",
      "Malave, Jesus & Janine - 1003",
      "Mancosh, Douglas & Kathy",
      "Perkins, Donna",
      "Sears, Edgar & Crystle",
      "Slyh John & Ann",
      "Tapper, Al",
      "Trainor James",
    ],
  },
  {
    primary: "Slatter, Danielle",
    secondaries: ["Slatter, Danielle - 1006"],
  },
  {
    primary: "SS Palm Beach, LLC",
    secondaries: [
      "SS Palm Beach, LLC - 1005",
      "SS Palm Beach, LLC - 1007",
      "SS Palm Beach, LLC - 1013",
    ],
  },
  {
    primary: "The Sailfish Club of Florida",
    secondaries: [
      "Sailfish Club of Florida (Storage)",
      "The Sailfish Club of Florida - 1012",
    ],
  },
  {
    primary: "Webster, Jeff & Marion",
    secondaries: ["Webster, Jeff & Marion - 1016"],
  },
  {
    primary: "Woodward Const, Mgmt",
    secondaries: [
      "Balek, Philip",
      "Haney Residence",
      "Haney Residence - 1009",
      "Savoy Residence",
      "Savoy Residence - 1000",
      "Weissman Residence",
      "Woodward, Brent",
    ],
  },
];
