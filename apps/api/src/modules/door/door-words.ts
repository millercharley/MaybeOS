/**
 * The words a door code can be (DOR-01).
 *
 * Charley, 2026-09-16: every code should be a real five-letter word, so a
 * member can remember it. A word is also self-correcting when it is read
 * aloud or written down, which random letters never are.
 *
 * How the list was built, so it can be rebuilt the same way:
 * - the five-letter words from a common-English frequency list, so every code
 *   is a word a member already knows;
 * - no I and no L, keeping Charley's original rule for the keypad and the
 *   phone screen — it also means the door script needs no change;
 * - proper nouns, brand names and abbreviations dropped against the system
 *   dictionary, so nobody is handed a brand or somebody's first name;
 * - anything unpleasant, frightening, clinical or crude removed by hand. A
 *   door code is given to a person, not chosen by them.
 *
 * 355 words. A co-op with more members than that runs out, and
 * `generateDoorPin` says what happens then.
 */
export const DOOR_WORDS: readonly string[] = [
  'ABOUT', 'ABOVE', 'ACTOR', 'ACUTE', 'ADDED', 'ADOPT', 'AFTER', 'AGENT',
  'AGREE', 'AHEAD', 'AMBER', 'AMEND', 'AMONG', 'APART', 'ARBOR', 'ARENA',
  'ARGUE', 'ARMOR', 'ARRAY', 'ARROW', 'ASSET', 'AWARD', 'AWARE', 'BACON',
  'BADGE', 'BAKER', 'BASED', 'BASES', 'BATCH', 'BEACH', 'BEGUN', 'BENCH',
  'BERRY', 'BOARD', 'BONUS', 'BOOST', 'BOOTH', 'BOOTS', 'BOUND', 'BRAKE',
  'BRAND', 'BRASS', 'BRAVE', 'BREAD', 'BREAK', 'BREED', 'BROAD', 'BROKE',
  'BROOK', 'BROWN', 'BRUSH', 'BUDDY', 'BUNCH', 'BUNNY', 'BUYER', 'CACHE',
  'CANDY', 'CARGO', 'CARRY', 'CATCH', 'CAUSE', 'CEDAR', 'CHARM', 'CHART',
  'CHASE', 'CHEAP', 'CHECK', 'CHESS', 'CHEST', 'CHOSE', 'COACH', 'COAST',
  'COMES', 'COUNT', 'COURT', 'COVER', 'CRAFT', 'CREAM', 'CREEK', 'CREST',
  'CROSS', 'CROWD', 'CROWN', 'CURVE', 'DANCE', 'DEPOT', 'DEPTH', 'DODGE',
  'DONOR', 'DOZEN', 'DRAFT', 'DRAWN', 'DREAM', 'DRESS', 'DROVE', 'EARTH',
  'EMPTY', 'ENDED', 'ENJOY', 'ENTER', 'ENTRY', 'ESSAY', 'EVENT', 'EVERY',
  'EXACT', 'EXTRA', 'FACED', 'FANCY', 'FAVOR', 'FENCE', 'FERRY', 'FOCUS',
  'FORCE', 'FORGE', 'FORTH', 'FORTY', 'FORUM', 'FOUND', 'FRAME', 'FRESH',
  'FRONT', 'FROST', 'FUNDS', 'FUNKY', 'FUNNY', 'FUZZY', 'GAMMA', 'GAUGE',
  'GENRE', 'GOODS', 'GRADE', 'GRAND', 'GRANT', 'GRAPH', 'GRASS', 'GREAT',
  'GREEN', 'GROUP', 'GROVE', 'GROWN', 'GUESS', 'GUEST', 'HANDY', 'HAPPY',
  'HAVEN', 'HEART', 'HEATH', 'HEAVY', 'HENCE', 'HOBBY', 'HONEY', 'HONOR',
  'HOPED', 'HORSE', 'HOUSE', 'HUMAN', 'HUMOR', 'JEANS', 'JUDGE', 'KARMA',
  'KNOCK', 'KNOWN', 'MACRO', 'MAJOR', 'MAKER', 'MANOR', 'MARCH', 'MARSH',
  'MATCH', 'MAYBE', 'MAYOR', 'MEANT', 'MERGE', 'MERRY', 'METER', 'MONEY',
  'MONTH', 'MOTOR', 'MOUNT', 'MOUSE', 'MOUTH', 'NEEDS', 'NEVER', 'NORTH',
  'NOTED', 'OCCUR', 'OCEAN', 'OFFER', 'OFTEN', 'OMEGA', 'OPERA', 'ORDER',
  'OTHER', 'OUGHT', 'OUTER', 'OWNER', 'OZONE', 'PANTS', 'PAPER', 'PARTY',
  'PASTE', 'PATCH', 'PEACE', 'PENNY', 'PHASE', 'PHONE', 'PHOTO', 'POUND',
  'POWER', 'PRESS', 'PROOF', 'PROVE', 'PROXY', 'PUPPY', 'PURSE', 'QUEEN',
  'QUERY', 'QUEST', 'QUEUE', 'QUOTE', 'RADAR', 'RANCH', 'RANGE', 'RATED',
  'REACH', 'READY', 'REFER', 'RENEW', 'RESET', 'ROBOT', 'ROCKY', 'ROUGE',
  'ROUND', 'ROUTE', 'ROVER', 'SANDY', 'SAUCE', 'SAVED', 'SAVER', 'SCENE',
  'SCOOP', 'SCOPE', 'SCORE', 'SCOUT', 'SENSE', 'SERUM', 'SERVE', 'SETUP',
  'SEVEN', 'SHADE', 'SHAKE', 'SHAPE', 'SHARE', 'SHARK', 'SHARP', 'SHEEP',
  'SHEER', 'SHEET', 'SHOOT', 'SHORE', 'SHORT', 'SHOWN', 'SMART', 'SOUND',
  'SOUTH', 'SPACE', 'SPARE', 'SPEAK', 'SPECS', 'SPEED', 'SPEND', 'SPENT',
  'SPOKE', 'SPORT', 'SPRAY', 'SQUAD', 'STACK', 'STAFF', 'STAGE', 'STAKE',
  'STAMP', 'STAND', 'START', 'STATE', 'STAYS', 'STEAM', 'STOCK', 'STONE',
  'STOOD', 'STORE', 'STORY', 'STRAP', 'STUDY', 'STUFF', 'SUGAR', 'SUNNY',
  'SUPER', 'SURGE', 'SWEET', 'TAKEN', 'TASTE', 'TEACH', 'TEENS', 'TEETH',
  'THANK', 'THEME', 'THERE', 'THESE', 'THETA', 'THOSE', 'THREE', 'THROW',
  'THUMB', 'TODAY', 'TOKEN', 'TONER', 'TOOTH', 'TOUCH', 'TOWER', 'TRACE',
  'TRACK', 'TRACT', 'TRADE', 'TREAT', 'TREND', 'TROUT', 'TRUCK', 'TRUNK',
  'TRUST', 'TRUTH', 'TUNER', 'TURBO', 'TURNS', 'UNDER', 'UPPER', 'URBAN',
  'USAGE', 'VENUE', 'VERSE', 'WAGES', 'WAGON', 'WATCH', 'WATER', 'WHEAT',
  'WHERE', 'WHOSE', 'WOMAN', 'WORKS', 'WORTH', 'WROTE', 'YACHT', 'YEAST',
  'YOUNG', 'YOURS', 'YOUTH',
];
