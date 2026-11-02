export const STYLES = Object.freeze({
  noir: { label: 'NOIR', badge: 'REPLAY', sting: 'horror', description: 'Monochrome mystery. Every missed shot has a motive.' },
  anime: { label: 'ANIME', badge: 'LEGENDARY', sting: 'riser', description: 'Magenta speedlines. Chat enters its final form.' },
  hollywood: { label: 'HOLLYWOOD', badge: 'LEGENDARY', sting: 'brass', description: 'Golden light. Blockbuster stakes, questionable decisions.' },
  baywatch: { label: 'BAYWATCH', badge: 'SLOW-MO', sting: 'heroic', description: 'Sunset orange. A heroic rescue of the entire vibe.' },
  sportscast: { label: 'SPORTSCAST', badge: 'BREAKING', sting: 'heroic', description: 'Electric blue. Instant analysis of an instant classic.' },
});

export const BADGES = Object.freeze(['REPLAY', 'BREAKING', 'SLOW-MO', 'LEGENDARY']);
export const STINGS = Object.freeze(['brass', 'horror', 'heroic', 'riser']);
export const isStyle = (style) => typeof style === 'string' && Object.hasOwn(STYLES, style);
