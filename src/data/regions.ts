export type RegionCode = 'SEA' | 'APAC' | 'NA' | 'EU' | 'SA' | 'MEA';
export type RegionFilter = 'ALL' | RegionCode;

export interface RegionInfo {
  code: RegionCode;
  name: string;
  shortLabel: string;
}

export const REGIONS: RegionInfo[] = [
  { code: 'SEA', name: 'Southeast Asia', shortLabel: 'SEA' },
  { code: 'APAC', name: 'East Asia & Oceania', shortLabel: 'APAC' },
  { code: 'NA', name: 'North America', shortLabel: 'NA' },
  { code: 'EU', name: 'Europe', shortLabel: 'EU' },
  { code: 'SA', name: 'South America', shortLabel: 'SA' },
  { code: 'MEA', name: 'Middle East & Africa', shortLabel: 'MEA' },
];

export const VALID_REGION_CODES = new Set<RegionCode>(REGIONS.map((r) => r.code));

export function getRegionInfo(code: RegionCode): RegionInfo {
  return REGIONS.find((r) => r.code === code) ?? REGIONS[0];
}

export function detectDefaultRegion(): RegionCode {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    if (
      /Kuala_Lumpur|Singapore|Jakarta|Bangkok|Manila|Ho_Chi_Minh|Brunei|Yangon|Phnom_Penh|Vientiane/i.test(
        tz
      )
    ) {
      return 'SEA';
    }
    if (
      /Tokyo|Seoul|Shanghai|Hong_Kong|Taipei|Sydney|Melbourne|Auckland|Perth|Brisbane|Asia\/(Kolkata|Dhaka|Karachi)/i.test(
        tz
      )
    ) {
      return 'APAC';
    }
    if (/^Europe\//i.test(tz) || /London|Dublin|Lisbon|Atlantic\/Reykjavik/i.test(tz)) {
      return 'EU';
    }
    if (
      /Sao_Paulo|Buenos_Aires|Santiago|Bogota|Lima|Montevideo|Caracas|La_Paz|Asuncion/i.test(
        tz
      )
    ) {
      return 'SA';
    }
    if (/^America\//i.test(tz)) {
      return 'NA';
    }
    if (/^Africa\//i.test(tz) || /Dubai|Riyadh|Qatar|Kuwait|Muscat|Jerusalem|Cairo/i.test(tz)) {
      return 'MEA';
    }
  } catch {
    // Fallback below
  }
  return 'SEA';
}
