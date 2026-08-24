export const AVATARS = [
  { id: "scout", style: "adventurer", seed: "FieldRush-scout", label: "Scout" },
  { id: "ranger", style: "adventurer", seed: "FieldRush-ranger", label: "Ranger" },
  { id: "heavy", style: "adventurer", seed: "FieldRush-heavy", label: "Heavy" },
  { id: "medic", style: "adventurer", seed: "FieldRush-medic", label: "Medic" },
  { id: "ridge", style: "adventurer", seed: "FieldRush-ridge", label: "Ridge" },
  { id: "mars", style: "adventurer", seed: "FieldRush-mars", label: "Mars" },
  { id: "captain", style: "adventurer", seed: "FieldRush-captain", label: "Captain" },
  {
    id: "bloom",
    style: "adventurer",
    seed: "FieldRush-bloom",
    label: "Bloom",
    opts: { hair: "long16", hairColor: "e5d7a3", skinColor: "f2d3b1", earringsProbability: "0", glassesProbability: "0", featuresProbability: "0" },
  },
  {
    id: "hazel",
    style: "adventurer",
    seed: "FieldRush-hazel",
    label: "Hazel",
    opts: { hair: "long08", hairColor: "6a4e35", skinColor: "f2d3b1", earringsProbability: "0", glassesProbability: "0", featuresProbability: "0" },
  },
  {
    id: "amber",
    style: "adventurer",
    seed: "FieldRush-amber",
    label: "Amber",
    opts: { hair: "long20", hairColor: "cb6820", skinColor: "f2d3b1", earringsProbability: "0", glassesProbability: "0", featuresProbability: "0" },
  },
  {
    id: "snow",
    style: "adventurer",
    seed: "FieldRush-snow",
    label: "Snow",
    opts: { hair: "long03", hairColor: "afafaf", skinColor: "f2d3b1", earringsProbability: "0", glassesProbability: "0", featuresProbability: "0" },
  },
  { id: "tesla", style: "pixel-art", seed: "FieldRush-tesla", label: "Spark" },
  { id: "flame", style: "pixel-art", seed: "FieldRush-flame", label: "Pyro" },
  { id: "ice", style: "pixel-art", seed: "FieldRush-ice", label: "Frost" },
  { id: "wrecker", style: "adventurer-neutral", seed: "FieldRush-wrecker", label: "Wrecker" },
  { id: "dozer", style: "adventurer-neutral", seed: "FieldRush-dozer", label: "Dozer" },
];

export function avatarById(id) {
  return AVATARS.find((row) => row.id === id) || AVATARS[0];
}

export function avatarUrl(id) {
  const row = avatarById(id);
  const extra = row.opts
    ? `&${new URLSearchParams(row.opts).toString()}`
    : "";
  return `https://api.dicebear.com/9.x/${row.style}/svg?seed=${encodeURIComponent(row.seed)}&backgroundColor=3a3228${extra}`;
}
