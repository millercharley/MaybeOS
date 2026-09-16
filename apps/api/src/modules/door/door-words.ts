/**
 * The words a door code can be (DOR-01).
 *
 * Charley, 2026-09-16: every code should be a real five-letter word, so a
 * member can remember it. A word is also self-correcting when it is read
 * aloud or written down, which random letters never are.
 *
 * **I and L are allowed.** The original rule left them out because `I`, `l`
 * and `1` are hard to tell apart — but a code is always shown in capitals in
 * a serif face (Charley, 2026-09-16), where `I` has its serifs and `L` cannot
 * be a `1`, and being a word settles anything the letters leave open. That
 * unlocked the most ordinary words in English: TABLE, LIGHT, RIVER, MUSIC.
 *
 * How the list was built, so it can be rebuilt the same way:
 * - the five-letter words from a common-English frequency list, so every code
 *   is a word a member already knows;
 * - proper nouns, brand names and abbreviations dropped against the system
 *   dictionary, so nobody is handed a brand or somebody else's first name;
 * - anything unpleasant, frightening, clinical or crude removed by hand. A
 *   door code is given to a person, not chosen by them.
 *
 * 719 words. A co-op with more members than that runs out, and
 * `generateDoorPin` says what happens then.
 */
export const DOOR_WORDS: readonly string[] = [
  'ABOUT', 'ABOVE', 'ACTOR', 'ACUTE', 'ADDED', 'ADMIT', 'ADOPT', 'ADULT',
  'AFTER', 'AGAIN', 'AGENT', 'AGING', 'AGREE', 'AHEAD', 'ALARM', 'ALBUM',
  'ALERT', 'ALIAS', 'ALIGN', 'ALIKE', 'ALIVE', 'ALLOW', 'ALLOY', 'ALONE',
  'ALONG', 'ALPHA', 'ALTER', 'AMBER', 'AMEND', 'AMINO', 'AMONG', 'ANGEL',
  'ANGLE', 'ANIME', 'ANNEX', 'APART', 'APPLY', 'ARBOR', 'ARENA', 'ARGUE',
  'ARISE', 'ARMOR', 'ARRAY', 'ARROW', 'ASIDE', 'ASSET', 'ATLAS', 'AUDIO',
  'AUDIT', 'AVOID', 'AWARD', 'AWARE', 'BACON', 'BADGE', 'BADLY', 'BAKER',
  'BASED', 'BASES', 'BASIC', 'BASIN', 'BASIS', 'BATCH', 'BEACH', 'BEGIN',
  'BEGUN', 'BEING', 'BELLE', 'BELLY', 'BELOW', 'BENCH', 'BERRY', 'BINGO',
  'BIRTH', 'BLACK', 'BLADE', 'BLANK', 'BLEND', 'BLESS', 'BLINK', 'BLOCK',
  'BLUES', 'BOARD', 'BONUS', 'BOOST', 'BOOTH', 'BOOTS', 'BOUND', 'BRAIN',
  'BRAKE', 'BRAND', 'BRASS', 'BRAVE', 'BREAD', 'BREAK', 'BREED', 'BRICK',
  'BRIDE', 'BRIEF', 'BRING', 'BROAD', 'BROKE', 'BROWN', 'BRUSH', 'BUDDY',
  'BUILD', 'BUILT', 'BUNCH', 'BUNNY', 'BUYER', 'CABIN', 'CABLE', 'CACHE',
  'CAMEL', 'CANAL', 'CANDY', 'CANON', 'CARGO', 'CARRY', 'CATCH', 'CAUSE',
  'CEDAR', 'CHAIN', 'CHAIR', 'CHARM', 'CHART', 'CHASE', 'CHEAP', 'CHECK',
  'CHESS', 'CHEST', 'CHIEF', 'CHILD', 'CHIPS', 'CHOIR', 'CHOSE', 'CIVIC',
  'CIVIL', 'CLAIM', 'CLASS', 'CLEAN', 'CLEAR', 'CLERK', 'CLICK', 'CLIMB',
  'CLIPS', 'CLOCK', 'CLONE', 'CLOSE', 'CLOTH', 'CLOUD', 'COACH', 'COAST',
  'COLON', 'COLOR', 'COMES', 'COMIC', 'CORAL', 'COULD', 'COUNT', 'COURT',
  'COVER', 'CRAFT', 'CREAM', 'CREEK', 'CREST', 'CROSS', 'CROWD', 'CROWN',
  'CUBIC', 'CURVE', 'CYCLE', 'DAILY', 'DAIRY', 'DANCE', 'DEALT', 'DEBUT',
  'DELAY', 'DELTA', 'DENSE', 'DEPOT', 'DEPTH', 'DIARY', 'DIGIT', 'DODGE',
  'DOING', 'DONOR', 'DOZEN', 'DRAFT', 'DRAIN', 'DRAWN', 'DREAM', 'DRESS',
  'DRIED', 'DRILL', 'DRINK', 'DRIVE', 'DROVE', 'EAGLE', 'EARLY', 'EARTH',
  'EIGHT', 'ELDER', 'ELECT', 'ELITE', 'EMPTY', 'ENDED', 'ENJOY', 'ENTER',
  'ENTRY', 'EQUAL', 'ESSAY', 'EVENT', 'EVERY', 'EXACT', 'EXIST', 'EXTRA',
  'FACED', 'FAIRY', 'FAITH', 'FALSE', 'FANCY', 'FAVOR', 'FENCE', 'FERRY',
  'FIBER', 'FIELD', 'FIFTH', 'FIFTY', 'FINAL', 'FIRED', 'FIRST', 'FIXED',
  'FLAME', 'FLASH', 'FLEET', 'FLOAT', 'FLOOD', 'FLOOR', 'FLOUR', 'FLUID',
  'FLUSH', 'FLYER', 'FOCAL', 'FOCUS', 'FORCE', 'FORGE', 'FORTH', 'FORTY',
  'FORUM', 'FOUND', 'FRAME', 'FRESH', 'FRONT', 'FROST', 'FRUIT', 'FULLY',
  'FUNDS', 'FUNKY', 'FUNNY', 'FUZZY', 'GAINS', 'GAMMA', 'GAUGE', 'GENRE',
  'GIANT', 'GIVEN', 'GLASS', 'GLOBE', 'GLORY', 'GOING', 'GOODS', 'GRADE',
  'GRAIN', 'GRAND', 'GRANT', 'GRAPH', 'GRASS', 'GREAT', 'GREEN', 'GRILL',
  'GROUP', 'GROVE', 'GROWN', 'GUESS', 'GUEST', 'GUIDE', 'GUILD', 'HANDY',
  'HAPPY', 'HAVEN', 'HEART', 'HEAVY', 'HELLO', 'HENCE', 'HIRED', 'HOBBY',
  'HONEY', 'HONOR', 'HOPED', 'HORSE', 'HOTEL', 'HOUSE', 'HUMAN', 'HUMOR',
  'IDEAL', 'IMAGE', 'INDEX', 'INNER', 'INPUT', 'INTER', 'ISSUE', 'IVORY',
  'JEANS', 'JEWEL', 'JOINT', 'JUDGE', 'JUICE', 'KARMA', 'KITTY', 'KNOCK',
  'KNOWN', 'LABEL', 'LABOR', 'LADEN', 'LARGE', 'LASER', 'LATER', 'LAUGH',
  'LAYER', 'LEARN', 'LEASE', 'LEAST', 'LEAVE', 'LEGAL', 'LEMON', 'LEVEL',
  'LIGHT', 'LIMIT', 'LINED', 'LINKS', 'LIVED', 'LIVER', 'LOBBY', 'LOCAL',
  'LODGE', 'LOGIC', 'LOOSE', 'LOWER', 'LUCKY', 'LUNCH', 'LYRIC', 'MACRO',
  'MAGIC', 'MAJOR', 'MAKER', 'MANOR', 'MAPLE', 'MARCH', 'MATCH', 'MAYBE',
  'MAYOR', 'MEANT', 'MEDAL', 'MEDIA', 'MERGE', 'MERIT', 'MERRY', 'METAL',
  'METER', 'MICRO', 'MIGHT', 'MINES', 'MINOR', 'MINUS', 'MIXED', 'MIXER',
  'MODEL', 'MONEY', 'MONTH', 'MORAL', 'MOTEL', 'MOTOR', 'MOUNT', 'MOUSE',
  'MOUTH', 'MOVIE', 'MUSIC', 'NAVAL', 'NEEDS', 'NEVER', 'NEWLY', 'NIGHT',
  'NOBLE', 'NOISE', 'NORTH', 'NOTED', 'NOVEL', 'NYLON', 'OASIS', 'OCCUR',
  'OCEAN', 'OFFER', 'OFTEN', 'OLDER', 'OMEGA', 'ONION', 'OPERA', 'ORBIT',
  'ORDER', 'OTHER', 'OUGHT', 'OUTER', 'OWNER', 'OXIDE', 'OZONE', 'PAINT',
  'PANEL', 'PANTS', 'PAPER', 'PARTY', 'PASTE', 'PATCH', 'PATIO', 'PEACE',
  'PEARL', 'PENNY', 'PHASE', 'PHONE', 'PHOTO', 'PIANO', 'PIECE', 'PILOT',
  'PITCH', 'PIZZA', 'PLACE', 'PLAIN', 'PLANE', 'PLANT', 'PLATE', 'PLAZA',
  'POINT', 'POKER', 'POLAR', 'POUND', 'POWER', 'PRESS', 'PRICE', 'PRIDE',
  'PRIME', 'PRINT', 'PRIOR', 'PRIZE', 'PROBE', 'PROOF', 'PROVE', 'PROXY',
  'PULSE', 'PUPPY', 'PURSE', 'QUEEN', 'QUERY', 'QUEST', 'QUEUE', 'QUICK',
  'QUIET', 'QUILT', 'QUITE', 'QUOTE', 'RADAR', 'RADIO', 'RAISE', 'RALLY',
  'RANCH', 'RANGE', 'RAPID', 'RATED', 'RATIO', 'REACH', 'READY', 'REALM',
  'REFER', 'RELAX', 'RELAY', 'RENEW', 'REPLY', 'RESET', 'RIDER', 'RIDGE',
  'RIGHT', 'RIVER', 'ROBOT', 'ROCKY', 'ROUGE', 'ROUGH', 'ROUND', 'ROUTE',
  'ROVER', 'ROYAL', 'RURAL', 'SAINT', 'SALAD', 'SALON', 'SANDY', 'SATIN',
  'SAUCE', 'SAVED', 'SAVER', 'SCALE', 'SCENE', 'SCOOP', 'SCOPE', 'SCORE',
  'SCOUT', 'SCREW', 'SENSE', 'SERUM', 'SERVE', 'SETUP', 'SEVEN', 'SHADE',
  'SHAFT', 'SHAKE', 'SHALL', 'SHAPE', 'SHARE', 'SHARK', 'SHARP', 'SHEEP',
  'SHEER', 'SHEET', 'SHELF', 'SHELL', 'SHIFT', 'SHINE', 'SHIRT', 'SHOOT',
  'SHORE', 'SHORT', 'SHOWN', 'SIDES', 'SIGHT', 'SIGMA', 'SILLY', 'SINCE',
  'SIXTH', 'SIZED', 'SIZES', 'SKILL', 'SKIRT', 'SLEEP', 'SLIDE', 'SLOPE',
  'SMALL', 'SMART', 'SMELL', 'SMILE', 'SNAKE', 'SOLAR', 'SOLID', 'SOLVE',
  'SONIC', 'SOUND', 'SOUTH', 'SPACE', 'SPARE', 'SPEAK', 'SPEED', 'SPELL',
  'SPEND', 'SPENT', 'SPICE', 'SPINE', 'SPLIT', 'SPOKE', 'SPORT', 'SPRAY',
  'SQUAD', 'STACK', 'STAFF', 'STAGE', 'STAKE', 'STAMP', 'STAND', 'START',
  'STATE', 'STAYS', 'STEAM', 'STEEL', 'STICK', 'STILL', 'STOCK', 'STONE',
  'STOOD', 'STORE', 'STORY', 'STRAP', 'STRIP', 'STUDY', 'STUFF', 'STYLE',
  'SUGAR', 'SUITE', 'SUNNY', 'SUPER', 'SURGE', 'SWEET', 'SWIFT', 'SWING',
  'TABLE', 'TAKEN', 'TALES', 'TASTE', 'TEACH', 'TEENS', 'TEETH', 'THANK',
  'THEIR', 'THEME', 'THERE', 'THESE', 'THETA', 'THICK', 'THING', 'THINK',
  'THIRD', 'THOSE', 'THREE', 'THROW', 'THUMB', 'TIGER', 'TIGHT', 'TIMER',
  'TIMES', 'TITLE', 'TODAY', 'TOKEN', 'TONER', 'TOOTH', 'TOPIC', 'TOTAL',
  'TOUCH', 'TOUGH', 'TOWER', 'TRACE', 'TRACK', 'TRACT', 'TRADE', 'TRAIL',
  'TRAIN', 'TREAT', 'TREND', 'TRIAL', 'TRIBE', 'TRICK', 'TRIED', 'TROUT',
  'TRUCK', 'TRULY', 'TRUNK', 'TRUST', 'TRUTH', 'TUNER', 'TURBO', 'TURNS',
  'TWICE', 'TWIST', 'ULTRA', 'UNCLE', 'UNDER', 'UNION', 'UNITY', 'UNTIL',
  'UPPER', 'URBAN', 'USAGE', 'USUAL', 'VALID', 'VALUE', 'VALVE', 'VAULT',
  'VENUE', 'VERSE', 'VIDEO', 'VILLA', 'VINYL', 'VISIT', 'VISTA', 'VITAL',
  'VOCAL', 'VOICE', 'WAGES', 'WAGON', 'WATCH', 'WATER', 'WHALE', 'WHEAT',
  'WHEEL', 'WHERE', 'WHICH', 'WHILE', 'WHITE', 'WHOLE', 'WHOSE', 'WIDTH',
  'WIRED', 'WOMAN', 'WORKS', 'WORLD', 'WORTH', 'WOULD', 'WRIST', 'WRITE',
  'WROTE', 'YACHT', 'YEAST', 'YIELD', 'YOUNG', 'YOURS', 'YOUTH',
];
