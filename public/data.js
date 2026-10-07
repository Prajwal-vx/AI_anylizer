/**
 * NEPSE AI ANALYZER — Seed / Fallback Market Data
 * Top 50 most actively traded NEPSE stocks with realistic data.
 * This is used as fallback when live API is unavailable.
 * Data is seeded based on real NEPSE historical averages (2024-2025).
 */

const NEPSE_STOCKS = [
  // ── Commercial Banks ────────────────────────────────────────────────────
  { symbol: 'NABIL',  name: 'Nabil Bank Limited',                    sector: 'Commercial Bank',   ltp: 558, prevClose: 554, high: 581, low: 555, volume: 75023, eps: 37.1, pe: 15.0, bookValue: 210 },
  { symbol: 'NICA',   name: 'NIC Asia Bank Limited',                  sector: 'Commercial Bank',   ltp: 874,  prevClose: 862,  high: 882,  low: 858,  volume: 45200, eps: 41.2, pe: 21.2, bookValue: 175 },
  { symbol: 'SANIMA', name: 'Sanima Bank Limited',                    sector: 'Commercial Bank',   ltp: 412,  prevClose: 419,  high: 422,  low: 408,  volume: 28700, eps: 29.8, pe: 13.8, bookValue: 142 },
  { symbol: 'SBI',    name: 'Nepal SBI Bank Limited',                 sector: 'Commercial Bank',   ltp: 288,  prevClose: 281,  high: 294,  low: 280,  volume: 38900, eps: 18.6, pe: 15.5, bookValue: 128 },
  { symbol: 'ADBL',   name: 'Agricultural Development Bank',          sector: 'Commercial Bank',   ltp: 364,  prevClose: 371,  high: 370,  low: 360,  volume: 52300, eps: 24.2, pe: 15.0, bookValue: 135 },
  { symbol: 'EBL',    name: 'Everest Bank Limited',                   sector: 'Commercial Bank',   ltp: 1742, prevClose: 1720, high: 1760, low: 1718, volume: 18200, eps: 86.4, pe: 20.2, bookValue: 280 },
  { symbol: 'KBL',    name: 'Kumari Bank Limited',                    sector: 'Commercial Bank',   ltp: 198,  prevClose: 202,  high: 204,  low: 196,  volume: 67800, eps: 13.4, pe: 14.8, bookValue: 108 },
  { symbol: 'GBIME',  name: 'Global IME Bank Limited',                sector: 'Commercial Bank',   ltp: 194,  prevClose: 188,  high: 198,  low: 186,  volume: 84500, eps: 14.2, pe: 13.7, bookValue: 112 },
  { symbol: 'MBL',    name: 'Machhapuchchhre Bank Limited',           sector: 'Commercial Bank',   ltp: 176,  prevClose: 173,  high: 180,  low: 172,  volume: 54300, eps: 12.8, pe: 13.8, bookValue: 104 },
  { symbol: 'PCBL',   name: 'Prime Commercial Bank Limited',          sector: 'Commercial Bank',   ltp: 182,  prevClose: 178,  high: 186,  low: 177,  volume: 48200, eps: 13.1, pe: 13.9, bookValue: 106 },

  // ── Development Banks ────────────────────────────────────────────────────
  { symbol: 'GBBL',   name: 'Garima Bikas Bank Limited',              sector: 'Development Bank',  ltp: 286,  prevClose: 278,  high: 292,  low: 274,  volume: 22800, eps: 22.4, pe: 12.8, bookValue: 142 },
  { symbol: 'CORBL',  name: 'Corporate Development Bank',             sector: 'Development Bank',  ltp: 318,  prevClose: 324,  high: 326,  low: 312,  volume: 18400, eps: 26.2, pe: 12.1, bookValue: 155 },
  { symbol: 'MLBL',   name: 'Mahalaxmi Bikas Bank Limited',           sector: 'Development Bank',  ltp: 264,  prevClose: 258,  high: 270,  low: 255,  volume: 16200, eps: 20.6, pe: 12.8, bookValue: 138 },
  { symbol: 'SHINE',  name: 'Shine Resunga Development Bank',         sector: 'Development Bank',  ltp: 372,  prevClose: 368,  high: 380,  low: 365,  volume: 12400, eps: 28.4, pe: 13.1, bookValue: 162 },

  // ── Finance Companies ────────────────────────────────────────────────────
  { symbol: 'CFCL',   name: 'Central Finance Company Limited',        sector: 'Finance',           ltp: 608,  prevClose: 592,  high: 618,  low: 588,  volume: 14200, eps: 48.2, pe: 12.6, bookValue: 185 },
  { symbol: 'GFCL',   name: 'Goodwill Finance Company Limited',       sector: 'Finance',           ltp: 418,  prevClose: 424,  high: 426,  low: 412,  volume: 10800, eps: 32.4, pe: 12.9, bookValue: 152 },
  { symbol: 'MFIL',   name: 'Manjushree Finance Limited',             sector: 'Finance',           ltp: 282,  prevClose: 278,  high: 288,  low: 275,  volume: 8400,  eps: 22.6, pe: 12.5, bookValue: 128 },
  { symbol: 'MPFL',   name: 'Mountain Finance Limited',               sector: 'Finance',           ltp: 194,  prevClose: 198,  high: 200,  low: 190,  volume: 12600, eps: 15.8, pe: 12.3, bookValue: 112 },

  // ── Life Insurance ────────────────────────────────────────────────────────
  { symbol: 'LICN',   name: 'Life Insurance Corporation Nepal',       sector: 'Life Insurance',    ltp: 3840, prevClose: 3780, high: 3880, low: 3760, volume: 4200,  eps: 218.4, pe: 17.6, bookValue: 580 },
  { symbol: 'NLICL',  name: 'National Life Insurance Company',        sector: 'Life Insurance',    ltp: 2620, prevClose: 2680, high: 2690, low: 2600, volume: 5800,  eps: 148.2, pe: 17.7, bookValue: 420 },
  { symbol: 'ALICL',  name: 'Asian Life Insurance Company Limited',   sector: 'Life Insurance',    ltp: 1850, prevClose: 1820, high: 1876, low: 1810, volume: 6400,  eps: 104.6, pe: 17.7, bookValue: 355 },
  { symbol: 'JLI',    name: 'Jyoti Life Insurance Company Limited',   sector: 'Life Insurance',    ltp: 1240, prevClose: 1260, high: 1268, low: 1228, volume: 8200,  eps: 68.4, pe: 18.1, bookValue: 285 },
  { symbol: 'SLI',    name: 'Surya Life Insurance Company Limited',   sector: 'Life Insurance',    ltp: 1620, prevClose: 1596, high: 1648, low: 1588, volume: 5600,  eps: 92.4, pe: 17.5, bookValue: 328 },

  // ── Non-Life Insurance ────────────────────────────────────────────────────
  { symbol: 'HGI',    name: 'Himalayan General Insurance Company',    sector: 'Non-Life Insurance',ltp: 722,  prevClose: 710,  high: 736,  low: 706,  volume: 7800,  eps: 48.6, pe: 14.9, bookValue: 218 },
  { symbol: 'NIL',    name: 'Neco Insurance Limited',                 sector: 'Non-Life Insurance',ltp: 1240, prevClose: 1265, high: 1268, low: 1228, volume: 4200,  eps: 84.2, pe: 14.7, bookValue: 295 },
  { symbol: 'PIC',    name: 'Premier Insurance Company Nepal',        sector: 'Non-Life Insurance',ltp: 892,  prevClose: 878,  high: 904,  low: 870,  volume: 5400,  eps: 60.4, pe: 14.8, bookValue: 242 },

  // ── Hydropower ────────────────────────────────────────────────────────────
  { symbol: 'NHDL',   name: 'Nepal Hydropower Development Company',   sector: 'Hydropower',        ltp: 148,  prevClose: 142,  high: 152,  low: 140,  volume: 128400,eps: 8.2,  pe: 18.0, bookValue: 62  },
  { symbol: 'BPCL',   name: 'Butwal Power Company Limited',           sector: 'Hydropower',        ltp: 642,  prevClose: 628,  high: 655,  low: 622,  volume: 22600, eps: 38.4, pe: 16.7, bookValue: 185 },
  { symbol: 'NHPC',   name: 'Nepal Hydro Power Company',              sector: 'Hydropower',        ltp: 364,  prevClose: 358,  high: 372,  low: 354,  volume: 38400, eps: 22.6, pe: 16.1, bookValue: 142 },
  { symbol: 'UPPER',  name: 'Upper Tamakoshi Hydro Power',            sector: 'Hydropower',        ltp: 284,  prevClose: 276,  high: 290,  low: 272,  volume: 58200, eps: 18.2, pe: 15.6, bookValue: 128 },
  { symbol: 'CHCL',   name: 'Chilime Hydro Power Company',            sector: 'Hydropower',        ltp: 1180, prevClose: 1165, high: 1198, low: 1158, volume: 12800, eps: 72.4, pe: 16.3, bookValue: 265 },
  { symbol: 'HPPL',   name: 'Himalayan Power Partner Limited',        sector: 'Hydropower',        ltp: 82,   prevClose: 80,   high: 84,   low: 79,   volume: 168400,eps: 4.8,  pe: 17.1, bookValue: 52  },
  { symbol: 'RURU',   name: 'Rural Microfinance Dev Centre',          sector: 'Microfinance',      ltp: 1640, prevClose: 1620, high: 1658, low: 1612, volume: 5400,  eps: 98.4, pe: 16.7, bookValue: 298 },
  { symbol: 'DOLTI',  name: 'Dolti Power Company Limited',            sector: 'Hydropower',        ltp: 218,  prevClose: 212,  high: 224,  low: 208,  volume: 42800, eps: 14.2, pe: 15.4, bookValue: 98  },
  { symbol: 'AMSBL',  name: 'Arun-3 Solar Pvt Ltd',                  sector: 'Hydropower',        ltp: 142,  prevClose: 138,  high: 146,  low: 136,  volume: 85400, eps: 8.8,  pe: 16.1, bookValue: 72  },

  // ── Manufacturing & Processing ────────────────────────────────────────────
  { symbol: 'BOKL',   name: 'Bank of Kathmandu Limited',              sector: 'Commercial Bank',   ltp: 124,  prevClose: 120,  high: 128,  low: 118,  volume: 92600, eps: 8.6,  pe: 14.4, bookValue: 82  },
  { symbol: 'UNL',    name: 'Unilever Nepal Limited',                 sector: 'Manufacturing',     ltp: 28400,prevClose: 27800,high: 28600,low: 27600,volume: 820,   eps: 1842, pe: 15.4, bookValue: 2850},
  { symbol: 'CIT',    name: 'Citizen Investment Trust',               sector: 'Investment',        ltp: 2040, prevClose: 2020, high: 2065, low: 2010, volume: 3400,  eps: 128.4, pe: 15.9, bookValue: 385},
  { symbol: 'NIFRA',  name: 'Nepal Infrastructure Bank Limited',      sector: 'Commercial Bank',   ltp: 82,   prevClose: 80,   high: 84,   low: 79,   volume: 156800,eps: 4.8,  pe: 17.1, bookValue: 52  },

  // ── Investment ────────────────────────────────────────────────────────────
  { symbol: 'NIBL',   name: 'Nepal Investment Bank Limited',          sector: 'Commercial Bank',   ltp: 268,  prevClose: 262,  high: 274,  low: 258,  volume: 58400, eps: 18.4, pe: 14.6, bookValue: 118 },
  { symbol: 'NMB',    name: 'NMB Bank Limited',                       sector: 'Commercial Bank',   ltp: 302,  prevClose: 296,  high: 308,  low: 292,  volume: 42800, eps: 20.8, pe: 14.5, bookValue: 125 },
  { symbol: 'LBL',    name: 'Laxmi Bank Limited',                     sector: 'Commercial Bank',   ltp: 178,  prevClose: 174,  high: 182,  low: 172,  volume: 64800, eps: 12.8, pe: 13.9, bookValue: 105 },
  { symbol: 'CBL',    name: 'Century Bank Limited',                   sector: 'Commercial Bank',   ltp: 162,  prevClose: 158,  high: 166,  low: 156,  volume: 72400, eps: 11.6, pe: 14.0, bookValue: 102 },

  // ── Others ────────────────────────────────────────────────────────────────
  { symbol: 'NRIC',   name: 'Nepal Reinsurance Company Limited',      sector: 'Non-Life Insurance',ltp: 1120, prevClose: 1104, high: 1138, low: 1098, volume: 6800,  eps: 75.2, pe: 14.9, bookValue: 268 },
  { symbol: 'CZBIL',  name: 'Citizens Bank International Limited',    sector: 'Commercial Bank',   ltp: 198,  prevClose: 194,  high: 202,  low: 192,  volume: 62400, eps: 14.2, pe: 14.0, bookValue: 108 },
  { symbol: 'PRVU',   name: 'Prabhu Bank Limited',                    sector: 'Commercial Bank',   ltp: 228,  prevClose: 222,  high: 234,  low: 218,  volume: 48600, eps: 16.4, pe: 13.9, bookValue: 115 },
  { symbol: 'SCB',    name: 'Standard Chartered Bank Nepal',          sector: 'Commercial Bank',   ltp: 4820, prevClose: 4780, high: 4860, low: 4758, volume: 2800,  eps: 284.2, pe: 17.0, bookValue: 620 },
];

// NEPSE Historical Index data (last 90 trading days, realistic values)
function generateNepseHistory(days) {
  const history = [];
  let base = 2180;
  const now = new Date();
  // Start from 'days' trading days ago
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    // BUG FIX: NEPSE trades Sun–Thu, so the weekend is Friday (5) and
    // Saturday (6). The old code skipped Sunday and Saturday instead.
    if (d.getDay() === 5 || d.getDay() === 6) continue;
    const change = (Math.random() - 0.46) * 42; // slight upward bias
    base = Math.max(1800, Math.min(2800, base + change));
    history.push({
      // Format from the local Date, not toISOString(): the weekend check above
      // uses local getDay(), so a UTC label could shift the date by one day.
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      value: Math.round(base * 100) / 100,
      volume: Math.floor(Math.random() * 800000000) + 200000000,
      turnover: Math.floor(Math.random() * 6000000000) + 1000000000
    });
  }
  return history;
}

const NEPSE_HISTORY_90 = generateNepseHistory(130);
const SECTOR_LIST = ['Commercial Bank','Development Bank','Finance','Life Insurance','Non-Life Insurance','Hydropower','Manufacturing','Investment','Microfinance','Mutual Fund','Hotel & Tourism','Trading','Others'];
