/**
 * Every card type the picker can show. Sizes match registry/profiles.
 * Yu-Gi-Oh is 59×86 and Magic is 63×88, the same pixels already on screen.
 */
export const GAMES = [
  {
    "id": "altered",
    "label": "Altered TCG",
    "tier": "Tier D",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "Not on the ARS title list fetched 27 Nov 2026. Confirm TAG database coverage before treating TAG as a sure acceptor."
  },
  {
    "id": "battle-spirits",
    "label": "Battle Spirits / Battle Spirits Saga",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists Battle Spirits. TAG language and poker-size limits apply."
  },
  {
    "id": "cabinet-t3",
    "label": "Cabinet / Turkey Red T3 class (5-3/4 × 8 in)",
    "tier": "Tier E",
    "status": "provisional",
    "provisional": true,
    "w": 146.1,
    "h": 203.2,
    "grader": "CGC published max is 2-5/8\" × 3-3/4\" — T3 is far larger, so CGC is not eligible on the published cap. TAG does not accept oversized/jumbo cards. ARS TCG size caps do not cover cabinets. SGC terms allow an upcharge on cards larger than 3-1/2\" × 5-1/2\". Confirm BGS current oversized policy before submitting; official current BGS size table was not on the public grading page this turn."
  },
  {
    "id": "caramel-e90",
    "label": "Caramel-size (E90-1 American Caramel class)",
    "tier": "Tier E",
    "status": "provisional",
    "provisional": true,
    "w": 38.1,
    "h": 69.9,
    "grader": "Same grader posture as tobacco-size: PSA/BGS/CGC/SGC yes; TAG no (undersize, pre-1989); ARS no."
  },
  {
    "id": "digimon",
    "label": "Digimon Card Game",
    "tier": "Tier A",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists DIGIMON CARD GAME and several legacy Digimon card products. TAG: poker-size; English, plus TAG language rules (JP not explicitly listed for Digimon on the 2 Jul 2026 TCG page — confirm before submitting JP to TAG)."
  },
  {
    "id": "dragon-ball",
    "label": "Dragon Ball Super Card Game / Fusion World",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "BGS Europe lists Dragon Ball. ARS lists DRAGON BALL SUPER CARD GAME plus many Heroes/Carddass/Divers lines (those Heroes/Carddass lines are NOT this size). TAG: English, plus 'select Dragon Ball TCG' and Japanese-language exceptions that meet TAG sizing; Heroes/Carddass/bridge size is not eligible at TAG."
  },
  {
    "id": "duel-masters",
    "label": "Duel Masters",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists デュエル・マスターズ and DUEL LEGEND. Large Japanese grading volume relative to North America. TAG language limits apply."
  },
  {
    "id": "final-fantasy-tcg",
    "label": "Final Fantasy Trading Card Game",
    "tier": "Tier D",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists ファイナルファンタジー トレーディングカードゲーム. TAG poker-size / language limits apply."
  },
  {
    "id": "fleshandblood",
    "label": "Flesh and Blood",
    "tier": "Tier A",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "CGC marketing lists Flesh and Blood. TAG: poker-size TCG, English. Not on the ARS title list fetched 27 Nov 2026."
  },
  {
    "id": "grand-archive",
    "label": "Grand Archive",
    "tier": "Tier D",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "Not on the ARS title list fetched 27 Nov 2026. TAG poker-size / language limits apply if the set is in TAG's database."
  },
  {
    "id": "gundam",
    "label": "Gundam Card Game",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists GUNDAM CARD GAME (and several legacy Gundam card products; GUNDAM WAR often has size-overcut issues per ARS). TAG accepts Gundam TCG in English only — Japanese-language Gundam is not eligible at TAG."
  },
  {
    "id": "hololive-ocg",
    "label": "hololive OFFICIAL CARD GAME",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists hololive OFFICIAL CARD GAME. TAG language limits apply."
  },
  {
    "id": "lorcana",
    "label": "Disney Lorcana",
    "tier": "Tier A",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "TAG: poker-size TCG, English (and other TAG language rules). ARS lists Disney LORCANA. BGS Europe explicitly lists Disney Lorcana."
  },
  {
    "id": "mtg",
    "label": "Magic: The Gathering",
    "tier": "Shipped",
    "status": "shipped",
    "provisional": false,
    "w": 63,
    "h": 88,
    "grader": ""
  },
  {
    "id": "nonsport-standard",
    "label": "Non-sport / entertainment (Garbage Pail Kids, Marvel, Star Wars Topps, and similar 2.5×3.5 issues)",
    "tier": "Tier B",
    "status": "provisional",
    "provisional": true,
    "w": 63.5,
    "h": 88.9,
    "grader": "CGC (11 Jul 2023) opened all non-sports including Garbage Pail Kids, Mars Attacks, Wacky Packages, Star Trek, from 1879 to today, within its size/thickness caps. TAG (23 Sep 2026) lists Marvel, DC, Garbage Pail Kids, Star Wars, Disney among accepted licensed brands, 1989–present, 2.5×3.5, ≤50pt, no relics. BGS: sports, gaming, and non-sports / Star Wars. ARS is TCG-title-based and is not a general non-sport grader."
  },
  {
    "id": "onepiece",
    "label": "One Piece Card Game",
    "tier": "Shipped",
    "status": "phase1-provisional-mm",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": ""
  },
  {
    "id": "pokemon",
    "label": "Pokémon TCG (EN + Japanese)",
    "tier": "Shipped",
    "status": "shipped",
    "provisional": false,
    "w": 63,
    "h": 88,
    "grader": ""
  },
  {
    "id": "riftbound",
    "label": "Riftbound (League of Legends TCG)",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "Appeared on TCGplayer GMV boards (Q3 2026). Not on the ARS title list fetched 27 Nov 2026. Confirm TAG database coverage."
  },
  {
    "id": "shadowverse-evolve",
    "label": "Shadowverse: Evolve",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists SHADOWVERSE EVOLVE but excludes 白裏面/トークン (white-back / tokens). TAG language limits apply (English TCG unless an exception is published)."
  },
  {
    "id": "sorcery",
    "label": "Sorcery: Contested Realm",
    "tier": "Tier D",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "Not on the ARS title list fetched 27 Nov 2026. TAG poker-size / language limits apply if the set is in TAG's database."
  },
  {
    "id": "sports-oversized-5x7",
    "label": "Oversized / box-topper 5×7 class",
    "tier": "Tier E",
    "status": "provisional",
    "provisional": true,
    "w": 127,
    "h": 177.8,
    "grader": "Larger than CGC's published 2-5/8\" × 3-3/4\" cap, so CGC is not eligible on that policy. TAG cannot accept oversized/jumbo. PSA app lists oversized trading cards (supersized, T3, jumbo); PSA chooses the holder. SGC: upcharge possible above 3-1/2\" × 5-1/2\". Confirm BGS current oversized policy before submitting."
  },
  {
    "id": "sports-standard",
    "label": "Sports (baseball, basketball, football, hockey incl. O-Pee-Chee, soccer, racing, combat)",
    "tier": "Shipped",
    "status": "phase1",
    "provisional": false,
    "w": 63.5,
    "h": 88.9,
    "grader": ""
  },
  {
    "id": "starwars-unlimited",
    "label": "Star Wars: Unlimited",
    "tier": "Tier A",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "BGS Europe explicitly lists Star Wars Unlimited. TAG: English poker-size TCG. Not on the ARS title list fetched 27 Nov 2026."
  },
  {
    "id": "tobacco-t206",
    "label": "Tobacco-size (T206 White Border class)",
    "tier": "Tier E",
    "status": "provisional",
    "provisional": true,
    "w": 36.5,
    "h": 66.7,
    "grader": "SGC is widely used for pre-war tobacco. CGC accepts cards 2-5/8×3-3/4 or smaller, so T206 fits; smaller-than-standard cards may get an inner sleeve. TAG cannot accept cards under 2.5×3.5, including tobacco-size and Topps 206 / Allen & Ginter minis. ARS size caps are TCG mini/regular only. Fragile tobacco may be returned unencapsulated."
  },
  {
    "id": "union-arena",
    "label": "Union Arena",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists UNION ARENA. TAG: English poker-size TCG; Japanese-language Union Arena not listed as a TAG exception (TAG JP exceptions are Pokémon, One Piece, select Dragon Ball). Confirm JP submissions with TAG."
  },
  {
    "id": "vanguard",
    "label": "Cardfight!! Vanguard",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 59,
    "h": 86,
    "grader": "ARS lists カードファイト!! ヴァンガード. TAG does not accept bridge/mini-width games (YGO, Dragon Ball Heroes, several Carddass) and Vanguard is official mini 59×86 — treat TAG as not eligible until TAG publishes otherwise."
  },
  {
    "id": "vintage-1952-topps",
    "label": "Vintage early-1950s sports (1952 Topps class, 2-5/8 × 3-6/8 in)",
    "tier": "Tier E",
    "status": "provisional",
    "provisional": true,
    "w": 66.7,
    "h": 95.3,
    "grader": "CGC maximum listed size is 2-5/8\" × 3-3/4\" (6.6 cm × 9.5 cm) — this class is at that cap. TAG accepts only 2.5×3.5 cards manufactured 1989–present, so TAG is not eligible. PSA app accepts tallboys and oversized holders; PSA chooses the holder."
  },
  {
    "id": "weiss-schwarz",
    "label": "Weiss Schwarz (incl. Blau and Rose)",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 63,
    "h": 88,
    "grader": "ARS lists Weiβ Schwarz, Weiß Schwarz Blau, Weiß Schwarz Rose. BGS Europe lists Weiss Schwarz. TAG accepts Weiss Schwarz in English only — Japanese-language Weiss is not eligible at TAG (help article 2 Jul 2026 / 23 Sep 2026)."
  },
  {
    "id": "yugioh-rush-duel",
    "label": "Yu-Gi-Oh! Rush Duel",
    "tier": "Tier C",
    "status": "provisional",
    "provisional": true,
    "w": 59,
    "h": 86,
    "grader": "ARS lists 遊戯王 RUSH DUEL. TAG does not accept Yu-Gi-Oh! / bridge sizing."
  },
  {
    "id": "yugioh",
    "label": "Yu-Gi-Oh!",
    "tier": "Shipped",
    "status": "shipped",
    "provisional": false,
    "w": 59,
    "h": 86,
    "grader": ""
  }
];

export const GAME_TIERS = ['Shipped', 'Tier A', 'Tier B', 'Tier C', 'Tier D', 'Tier E'];

export function gameById(id) {
  if (id === 'ygo') return GAMES.find((row) => row.id === 'yugioh');
  if (id === 'mtg') return GAMES.find((row) => row.id === 'mtg');
  return GAMES.find((row) => row.id === id) || null;
}

/** Camera guide in millimetres. Yu-Gi-Oh and Magic stay on the shipped pixels. */
export function guideForSelect(value) {
  if (value === 'mtg') return { w: 63, h: 88 };
  if (!value || value === 'all' || value === 'ygo' || value === 'yugioh') return { w: 59, h: 86 };
  if (String(value).startsWith('size:')) {
    const id = String(value).slice(5);
    const sizes = {
      yugioh: [59, 86],
      'standard-tcg': [63, 88],
      sports: [63.5, 88.9],
      'vintage-1952': [66.7, 95.3],
      'tobacco-t206': [36.5, 66.7],
      'caramel-e90': [38.1, 69.9],
      'oversized-5x7': [127, 177.8],
      'cabinet-t3': [146.1, 203.2],
    };
    const pair = sizes[id];
    if (pair) return { w: pair[0], h: pair[1] };
  }
  const game = gameById(value);
  if (!game) return { w: 59, h: 86 };
  if (game.id === 'yugioh') return { w: 59, h: 86 };
  if (game.id === 'mtg') return { w: 63, h: 88 };
  return { w: game.w, h: game.h };
}
