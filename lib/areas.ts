import { areaMatches } from "./decide";

export const BENGALURU_AREA_OPTIONS = [
  "Ashok Nagar",
  "Banashankari",
  "Basavanagudi",
  "Bellandur",
  "Benson Town",
  "Brigade Road",
  "Brookefield",
  "BTM Layout",
  "Church Street",
  "Cooke Town",
  "Cunningham Road",
  "Domlur",
  "Electronic City",
  "Frazer Town",
  "Gandhi Nagar",
  "Hebbal",
  "Hennur",
  "HSR Layout",
  "Indiranagar",
  "Jayanagar",
  "JP Nagar",
  "Kalyan Nagar",
  "Kammanahalli",
  "Koramangala",
  "Lavelle Road",
  "Malleshwaram",
  "Marathahalli",
  "MG Road",
  "Rajajinagar",
  "Residency Road",
  "Richmond Town",
  "Sadashivanagar",
  "Sahakara Nagar",
  "Sarjapur Road",
  "Shantinagar",
  "Shivajinagar",
  "St. Marks Road",
  "Ulsoor",
  "Vasanth Nagar",
  "Whitefield",
  "Yelahanka",
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

export function knownAreaFromText(
  text: string,
  areas: readonly string[] = BENGALURU_AREA_OPTIONS
): string | undefined {
  const key = norm(text);
  if (!key) return undefined;
  return [...areas]
    .sort((a, b) => norm(b).length - norm(a).length)
    .find((area) => key.includes(norm(area)) || areaMatches(area, text));
}
