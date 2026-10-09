/**
 * The emoji people can search (CMN-24).
 *
 * Charley: "the library picker would also allow people to easily search and
 * pick any emoji."
 *
 * **Held here rather than taken from a package.** A full set is about 3,800
 * entries with their annotations — a megabyte of data and, in the usual
 * libraries, a React component with its own styling that would not match
 * anything else here. This app has twenty-one dependencies and that is a
 * choice worth keeping.
 *
 * So: a few hundred, chosen for what a co-op actually reacts with and
 * searchable by what people would type. Anything outside it is still
 * reachable — the picker keeps a field that takes any emoji at all, pasted
 * from the keyboard every device already has.
 *
 * `tone` marks the ones that take a skin tone. Only single-codepoint forms
 * are marked: a tone goes on the end of those correctly, where a joined
 * sequence like 👨‍🦰 needs the modifier inserted mid-sequence and is a
 * different problem. Nothing is marked that would render wrong.
 */
export interface EmojiEntry {
  emoji: string;
  name: string;
  keywords: string;
  tone?: true;
}

export interface EmojiGroup {
  name: string;
  emoji: EmojiEntry[];
}

export const EMOJI_LIBRARY: EmojiGroup[] = [
  {
    name: 'Reactions',
    emoji: [
      { emoji: '👍', name: 'thumbs up', keywords: 'yes agree like approve good +1', tone: true },
      { emoji: '❤️', name: 'red heart', keywords: 'love like favourite' },
      { emoji: '🎉', name: 'party popper', keywords: 'celebrate congrats hooray party' },
      { emoji: '😂', name: 'tears of joy', keywords: 'laugh funny lol haha' },
      { emoji: '🙏', name: 'thank you', keywords: 'please thanks grateful pray', tone: true },
      { emoji: '👀', name: 'eyes', keywords: 'looking watching seen interest' },
      { emoji: '👎', name: 'thumbs down', keywords: 'no disagree bad -1', tone: true },
      { emoji: '👏', name: 'clap', keywords: 'applause well done bravo praise', tone: true },
      { emoji: '🙌', name: 'raised hands', keywords: 'celebrate hooray praise yay', tone: true },
      { emoji: '👋', name: 'wave', keywords: 'hello hi bye goodbye greeting', tone: true },
      { emoji: '🤝', name: 'handshake', keywords: 'deal agree partner together' },
      { emoji: '✌️', name: 'peace', keywords: 'victory two fingers', tone: true },
      { emoji: '🤞', name: 'fingers crossed', keywords: 'hope luck wish', tone: true },
      { emoji: '💪', name: 'strong', keywords: 'muscle power flex strength', tone: true },
      { emoji: '🤟', name: 'love you', keywords: 'hand sign rock', tone: true },
      { emoji: '👌', name: 'ok', keywords: 'perfect fine good nice', tone: true },
      { emoji: '🫶', name: 'heart hands', keywords: 'love care appreciate', tone: true },
      { emoji: '✋', name: 'raised hand', keywords: 'stop high five volunteer', tone: true },
      { emoji: '☝️', name: 'point up', keywords: 'one this attention', tone: true },
      { emoji: '🧡', name: 'orange heart', keywords: 'love like' },
      { emoji: '💛', name: 'yellow heart', keywords: 'love like' },
      { emoji: '💚', name: 'green heart', keywords: 'love like' },
      { emoji: '💙', name: 'blue heart', keywords: 'love like' },
      { emoji: '💜', name: 'purple heart', keywords: 'love like' },
      { emoji: '🖤', name: 'black heart', keywords: 'love like' },
      { emoji: '🤎', name: 'brown heart', keywords: 'love like' },
      { emoji: '🔥', name: 'fire', keywords: 'hot lit great amazing' },
      { emoji: '🎊', name: 'confetti', keywords: 'celebrate party' },
      { emoji: '✨', name: 'sparkles', keywords: 'shiny new lovely magic' },
      { emoji: '⭐', name: 'star', keywords: 'favourite good rating' },
      { emoji: '✅', name: 'tick', keywords: 'done yes check complete agreed' },
      { emoji: '❌', name: 'cross', keywords: 'no wrong cancel' },
      { emoji: '💯', name: 'hundred', keywords: 'perfect agree fully' },
      { emoji: '🚀', name: 'rocket', keywords: 'launch fast ship go' },
      { emoji: '💡', name: 'idea', keywords: 'light bulb electricity suggestion thought' },
      { emoji: '⚡', name: 'lightning', keywords: 'fast energy power' },
      { emoji: '🏆', name: 'trophy', keywords: 'win award best' },
    ],
  },
  {
    name: 'Faces',
    emoji: [
      { emoji: '😀', name: 'grinning', keywords: 'happy smile joy' },
      { emoji: '😄', name: 'smile', keywords: 'happy joy pleased' },
      { emoji: '😊', name: 'blush', keywords: 'happy shy pleased warm' },
      { emoji: '🙂', name: 'slight smile', keywords: 'happy fine ok' },
      { emoji: '😉', name: 'wink', keywords: 'joke flirt hint' },
      { emoji: '😍', name: 'heart eyes', keywords: 'love adore crush' },
      { emoji: '🥰', name: 'smiling with hearts', keywords: 'love affection warm' },
      { emoji: '🤣', name: 'rolling laughing', keywords: 'laugh funny lol rofl' },
      { emoji: '😅', name: 'sweat smile', keywords: 'relief phew nervous laugh' },
      { emoji: '🙃', name: 'upside down', keywords: 'irony sarcasm silly' },
      { emoji: '😌', name: 'relieved', keywords: 'calm content peaceful' },
      { emoji: '🤔', name: 'thinking', keywords: 'hmm consider question wonder' },
      { emoji: '🤗', name: 'hug', keywords: 'warm welcome embrace' },
      { emoji: '😎', name: 'sunglasses', keywords: 'cool confident' },
      { emoji: '🥳', name: 'partying', keywords: 'celebrate birthday party' },
      { emoji: '😢', name: 'crying', keywords: 'sad tear upset' },
      { emoji: '😭', name: 'sobbing', keywords: 'sad cry overwhelmed' },
      { emoji: '😤', name: 'determined', keywords: 'proud frustrated steam' },
      { emoji: '😮', name: 'surprised', keywords: 'wow shock oh' },
      { emoji: '🤯', name: 'mind blown', keywords: 'shock amazed wow' },
      { emoji: '😴', name: 'sleeping', keywords: 'tired bored zzz' },
      { emoji: '🤒', name: 'unwell', keywords: 'sick ill poorly' },
      { emoji: '🫠', name: 'melting', keywords: 'overwhelmed hot embarrassed' },
      { emoji: '🙈', name: 'see no evil', keywords: 'monkey hide embarrassed oops' },
      { emoji: '🥹', name: 'holding back tears', keywords: 'moved touched proud' },
    ],
  },
  {
    name: 'People',
    emoji: [
      { emoji: '🧑', name: 'person', keywords: 'adult someone', tone: true },
      { emoji: '👩', name: 'woman', keywords: 'adult she', tone: true },
      { emoji: '👨', name: 'man', keywords: 'adult he', tone: true },
      { emoji: '🧒', name: 'child', keywords: 'kid young', tone: true },
      { emoji: '👶', name: 'baby', keywords: 'infant newborn', tone: true },
      { emoji: '🧓', name: 'older person', keywords: 'elder senior', tone: true },
      { emoji: '🧑‍🍳', name: 'cook', keywords: 'chef kitchen food' },
      { emoji: '🧑‍🏫', name: 'teacher', keywords: 'class learn school' },
      { emoji: '🧑‍🌾', name: 'farmer', keywords: 'garden grow allotment' },
      { emoji: '🧑‍🎨', name: 'artist', keywords: 'paint art studio' },
      { emoji: '🧑‍🔧', name: 'mechanic', keywords: 'repair fix tools' },
      { emoji: '🧑‍💻', name: 'at a computer', keywords: 'work tech coding' },
      { emoji: '💃', name: 'dancing', keywords: 'dance party celebrate', tone: true },
      { emoji: '🕺', name: 'dancing man', keywords: 'dance party celebrate', tone: true },
      { emoji: '🚶', name: 'walking', keywords: 'walk go stroll', tone: true },
      { emoji: '🧘', name: 'meditating', keywords: 'yoga calm quiet zen', tone: true },
    ],
  },
  {
    name: 'The building',
    emoji: [
      { emoji: '🏠', name: 'house', keywords: 'home building' },
      { emoji: '🏢', name: 'office', keywords: 'building work' },
      { emoji: '🚪', name: 'door', keywords: 'entry access room' },
      { emoji: '🔑', name: 'key', keywords: 'access door lock' },
      { emoji: '🪑', name: 'chair', keywords: 'seat furniture' },
      { emoji: '🧹', name: 'broom', keywords: 'clean tidy sweep chore' },
      { emoji: '🔧', name: 'spanner', keywords: 'fix repair tool maintenance' },
      { emoji: '🔨', name: 'hammer', keywords: 'build fix tool' },
      { emoji: '🪴', name: 'plant', keywords: 'green grow pot' },
      { emoji: '🚲', name: 'bike', keywords: 'cycle ride transport' },
      { emoji: '📦', name: 'box', keywords: 'package delivery storage' },
    ],
  },
  {
    name: 'Gathering',
    emoji: [
      { emoji: '📅', name: 'calendar', keywords: 'date event when schedule' },
      { emoji: '⏰', name: 'clock', keywords: 'time alarm when late' },
      { emoji: '📣', name: 'announcement', keywords: 'shout news notice' },
      { emoji: '💬', name: 'speech', keywords: 'talk chat comment' },
      { emoji: '🗳️', name: 'ballot', keywords: 'vote decide proposal' },
      { emoji: '📝', name: 'note', keywords: 'write memo minutes' },
      { emoji: '📚', name: 'books', keywords: 'read library learn' },
      { emoji: '🎨', name: 'art', keywords: 'paint craft creative' },
      { emoji: '🎭', name: 'theatre', keywords: 'drama performance show' },
      { emoji: '🎶', name: 'music', keywords: 'song sound band' },
      { emoji: '🎬', name: 'film', keywords: 'movie screening video' },
      { emoji: '📷', name: 'camera', keywords: 'photo picture' },
      { emoji: '🎤', name: 'microphone', keywords: 'sing speak open mic' },
      { emoji: '🧵', name: 'thread', keywords: 'sew craft textile' },
      { emoji: '♻️', name: 'recycle', keywords: 'reuse green waste' },
      { emoji: '🌱', name: 'seedling', keywords: 'grow new garden start' },
    ],
  },
  {
    name: 'Food and drink',
    emoji: [
      { emoji: '☕', name: 'coffee', keywords: 'tea hot drink break' },
      { emoji: '🍵', name: 'tea', keywords: 'green hot drink' },
      { emoji: '🍲', name: 'stew', keywords: 'food dinner pot meal' },
      { emoji: '🥘', name: 'pan of food', keywords: 'cook meal share' },
      { emoji: '🍕', name: 'pizza', keywords: 'food slice' },
      { emoji: '🥗', name: 'salad', keywords: 'food healthy green' },
      { emoji: '🍞', name: 'bread', keywords: 'bake loaf food' },
      { emoji: '🧁', name: 'cupcake', keywords: 'cake sweet bake' },
      { emoji: '🎂', name: 'birthday cake', keywords: 'celebrate party' },
      { emoji: '🍎', name: 'apple', keywords: 'fruit food' },
      { emoji: '🥕', name: 'carrot', keywords: 'vegetable food garden' },
      { emoji: '🍻', name: 'drinks', keywords: 'beer cheers social pub' },
    ],
  },
  {
    name: 'Money and admin',
    emoji: [
      { emoji: '💰', name: 'money', keywords: 'cash funds budget' },
      { emoji: '💳', name: 'card', keywords: 'pay dues payment' },
      { emoji: '🧾', name: 'receipt', keywords: 'invoice expense bill' },
      { emoji: '📊', name: 'chart', keywords: 'data report numbers' },
      { emoji: '📈', name: 'rising', keywords: 'growth up increase' },
      { emoji: '📉', name: 'falling', keywords: 'decline down decrease' },
      { emoji: '📌', name: 'pin', keywords: 'important keep notice' },
      { emoji: '📎', name: 'paperclip', keywords: 'attach file' },
      { emoji: '🔒', name: 'locked', keywords: 'private secure closed' },
      { emoji: '⚠️', name: 'warning', keywords: 'careful caution alert' },
      { emoji: '❓', name: 'question', keywords: 'ask unsure help' },
      { emoji: '❗', name: 'exclamation', keywords: 'important urgent' },
    ],
  },
  {
    name: 'Weather and nature',
    emoji: [
      { emoji: '☀️', name: 'sun', keywords: 'sunny bright warm weather' },
      { emoji: '🌧️', name: 'rain', keywords: 'wet weather shower' },
      { emoji: '❄️', name: 'snow', keywords: 'cold winter weather' },
      { emoji: '🌈', name: 'rainbow', keywords: 'pride colour hope' },
      { emoji: '🌙', name: 'moon', keywords: 'night evening late' },
      { emoji: '🌳', name: 'tree', keywords: 'nature park green' },
      { emoji: '🌻', name: 'sunflower', keywords: 'flower garden summer' },
      { emoji: '🐝', name: 'bee', keywords: 'garden pollinator busy' },
      { emoji: '🐦', name: 'bird', keywords: 'nature garden' },
      { emoji: '🐶', name: 'dog', keywords: 'pet animal' },
      { emoji: '🐱', name: 'cat', keywords: 'pet animal' },
      { emoji: '🌊', name: 'wave', keywords: 'sea water ocean' },
    ],
  },
];

/** Flat, for searching and for checking whether something takes a tone. */
export const ALL_EMOJI: EmojiEntry[] = EMOJI_LIBRARY.flatMap((g) => g.emoji);

const BY_EMOJI = new Map(ALL_EMOJI.map((e) => [e.emoji, e]));

/** Does this one take a skin tone? Unknown emoji are left alone. */
export function takesTone(emoji: string): boolean {
  return BY_EMOJI.get(emoji)?.tone === true;
}

/**
 * Search by name or keyword.
 *
 * Every word typed has to match something, so "green heart" narrows rather
 * than widening to everything green plus everything heart — which is what
 * somebody typing two words means.
 */
export function searchEmoji(query: string, limit = 48): EmojiEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  return ALL_EMOJI.filter((entry) => {
    const haystack = `${entry.name} ${entry.keywords}`;
    return words.every((word) => haystack.includes(word));
  }).slice(0, limit);
}
