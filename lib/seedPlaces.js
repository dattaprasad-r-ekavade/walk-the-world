// Seed catalog for pre-warming the R2 city cache (scripts/warm-cities.mjs).
// Every entry is a walkable central spot (street/plaza/ghat), not a rooftop.
// Groups: fast-travel PLACES are merged in by the script automatically.

export const SEED_GROUPS = {
  "Major Indian cities": [
    { name: "Delhi", lat: 28.6315, lon: 77.2167 }, // Connaught Place
    { name: "Bengaluru", lat: 12.9757, lon: 77.6066 }, // MG Road
    { name: "Hyderabad", lat: 17.3616, lon: 78.4747 }, // Charminar
    { name: "Chennai", lat: 13.05, lon: 80.2824 }, // Marina Beach road
    { name: "Kolkata", lat: 22.5535, lon: 88.352 }, // Park Street
    { name: "Pune", lat: 18.5196, lon: 73.8554 }, // JM Road
    { name: "Ahmedabad", lat: 23.0225, lon: 72.5714 },
    { name: "Jaipur", lat: 26.9239, lon: 75.8267 }, // Hawa Mahal
    { name: "Lucknow", lat: 26.85, lon: 80.9462 }, // Hazratganj
    { name: "Surat", lat: 21.1702, lon: 72.8311 },
    { name: "Nagpur", lat: 21.1458, lon: 79.0882 },
    { name: "Indore", lat: 22.7196, lon: 75.8577 },
    { name: "Bhopal", lat: 23.2599, lon: 77.4126 },
    { name: "Varanasi", lat: 25.3109, lon: 83.0104 }, // Dashashwamedh Ghat
    { name: "Amritsar", lat: 31.62, lon: 74.8765 }, // Golden Temple area
    { name: "Kochi", lat: 9.9658, lon: 76.2422 }, // Fort Kochi
    { name: "Chandigarh", lat: 30.7415, lon: 76.7681 }, // Sector 17
    { name: "Mysuru", lat: 12.3052, lon: 76.6552 }, // Palace surrounds
  ],

  "Goa": [
    { name: "Panaji", lat: 15.4989, lon: 73.8278 }, // 18th June Road
    { name: "Calangute", lat: 15.5439, lon: 73.7553 },
    { name: "Baga", lat: 15.556, lon: 73.7516 },
    { name: "Anjuna", lat: 15.5735, lon: 73.7407 },
    { name: "Vagator", lat: 15.5977, lon: 73.7443 },
    { name: "Candolim", lat: 15.5186, lon: 73.7626 },
    { name: "Arambol", lat: 15.6869, lon: 73.7042 },
    { name: "Old Goa", lat: 15.5009, lon: 73.9116 }, // Basilica of Bom Jesus
    { name: "Margao", lat: 15.2832, lon: 73.9862 },
    { name: "Colva", lat: 15.2793, lon: 73.922 },
    { name: "Palolem", lat: 15.01, lon: 74.023 },
    { name: "Dona Paula", lat: 15.4511, lon: 73.8047 },
  ],

  // capitals not already covered by PLACES (London/Paris/Tokyo/Berlin/
  // Amsterdam/Rome/Singapore/Seoul are in the fast-travel list)
  "World capitals": [
    { name: "Washington DC", lat: 38.8895, lon: -77.0353 }, // National Mall
    { name: "Ottawa", lat: 45.4236, lon: -75.7009 },
    { name: "Mexico City", lat: 19.4326, lon: -99.1332 }, // Zócalo
    { name: "Brasília", lat: -15.7997, lon: -47.8645 },
    { name: "Buenos Aires", lat: -34.6083, lon: -58.3712 }, // Plaza de Mayo
    { name: "Madrid", lat: 40.4169, lon: -3.7035 }, // Puerta del Sol
    { name: "Lisbon", lat: 38.7077, lon: -9.1365 }, // Praça do Comércio
    { name: "Vienna", lat: 48.2084, lon: 16.3725 }, // Stephansplatz
    { name: "Prague", lat: 50.0875, lon: 14.4213 }, // Old Town Square
    { name: "Warsaw", lat: 52.2319, lon: 21.0067 },
    { name: "Athens", lat: 37.9755, lon: 23.7348 }, // Syntagma
    { name: "Cairo", lat: 30.0444, lon: 31.2357 }, // Tahrir Square
    { name: "Nairobi", lat: -1.2864, lon: 36.8172 },
    { name: "Cape Town", lat: -33.9221, lon: 18.4231 },
    { name: "Moscow", lat: 55.7539, lon: 37.6208 }, // Red Square
    { name: "Beijing", lat: 39.9042, lon: 116.3912 }, // Tiananmen
    { name: "Bangkok", lat: 13.75, lon: 100.4915 }, // Grand Palace
    { name: "Hanoi", lat: 21.0285, lon: 105.8542 }, // Hoan Kiem
    { name: "Jakarta", lat: -6.1754, lon: 106.8272 },
    { name: "Manila", lat: 14.5995, lon: 120.9842 },
    { name: "Canberra", lat: -35.2809, lon: 149.13 },
    { name: "Wellington", lat: -41.2865, lon: 174.7762 },
    { name: "Riyadh", lat: 24.7136, lon: 46.6753 },
    { name: "Abu Dhabi", lat: 24.4539, lon: 54.3773 },
    { name: "Jerusalem", lat: 31.7767, lon: 35.2345 }, // Old City
    { name: "Stockholm", lat: 59.3251, lon: 18.0711 },
    { name: "Oslo", lat: 59.9139, lon: 10.7522 },
    { name: "Copenhagen", lat: 55.6761, lon: 12.5683 },
    { name: "Helsinki", lat: 60.1699, lon: 24.9384 },
    { name: "Dublin", lat: 53.3498, lon: -6.2603 },
    { name: "Bern", lat: 46.948, lon: 7.4474 },
    { name: "Brussels", lat: 50.8467, lon: 4.3525 }, // Grand-Place
    { name: "Budapest", lat: 47.4979, lon: 19.0402 },
    { name: "Kyiv", lat: 50.4501, lon: 30.5234 },
  ],

  "7 Wonders (new) + Giza": [
    { name: "Taj Mahal", lat: 27.1751, lon: 78.0421 }, // Agra
    { name: "Great Wall", lat: 40.4319, lon: 116.5704 }, // Mutianyu
    { name: "Petra", lat: 30.3285, lon: 35.4444 },
    { name: "Colosseum", lat: 41.8902, lon: 12.4922 },
    { name: "Christ the Redeemer", lat: -22.9519, lon: -43.2105 },
    { name: "Machu Picchu", lat: -13.1631, lon: -72.545 },
    { name: "Chichén Itzá", lat: 20.6843, lon: -88.5678 },
    { name: "Giza Pyramids", lat: 29.9773, lon: 31.1325 },
  ],
};
