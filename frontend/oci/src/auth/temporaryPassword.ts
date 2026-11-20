// A temporary password an Admin hands to a person (#468): generated here,
// in the browser, so the Admin never invents one. Readable words so it can be
// read aloud or pasted into a message; the person must replace it at first
// sign-in, and sign-in is throttled, so three words and a number suffice.

/** 256 short, distinct, easy-to-spell words (8 bits each). */
// prettier-ignore
const WORDS = [
  "acorn", "amber", "anchor", "apple", "arrow", "aspen", "atlas", "autumn",
  "badge", "bagel", "bamboo", "banjo", "basil", "beach", "beacon", "berry",
  "birch", "bison", "blossom", "bottle", "breeze", "brick", "bridge", "brook",
  "bucket", "button", "cabin", "cactus", "camel", "candle", "canoe", "canyon",
  "carrot", "castle", "cedar", "cello", "chalk", "cherry", "cider", "cinder",
  "citrus", "clover", "cobalt", "comet", "copper", "coral", "cotton", "crane",
  "crayon", "cricket", "crystal", "cumin", "daisy", "delta", "denim", "desert",
  "dolphin", "dragon", "drum", "dune", "eagle", "echo", "ember", "falcon",
  "fern", "fiddle", "finch", "fjord", "flame", "flint", "forest", "fossil",
  "fox", "garden", "garnet", "ginger", "glacier", "globe", "goose", "granite",
  "grape", "gravel", "guitar", "hammer", "harbor", "hazel", "heron", "hickory",
  "honey", "horizon", "husky", "iris", "island", "ivory", "jacket", "jasmine",
  "jelly", "jigsaw", "juniper", "kayak", "kettle", "kiwi", "koala", "ladder",
  "lagoon", "lantern", "laurel", "lemon", "lilac", "linen", "lizard", "lotus",
  "magnet", "mango", "maple", "marble", "meadow", "melon", "meteor", "mint",
  "mitten", "monsoon", "moose", "mosaic", "moss", "muffin", "nectar", "needle",
  "nickel", "noodle", "nutmeg", "oasis", "ocean", "olive", "onion", "orbit",
  "orchid", "otter", "owl", "paddle", "panda", "papaya", "parrot", "peach",
  "pebble", "pepper", "piano", "pigeon", "pillow", "pine", "pirate", "planet",
  "plum", "pocket", "pollen", "pony", "poppy", "prairie", "pumpkin", "puzzle",
  "quartz", "quill", "rabbit", "radish", "rain", "raven", "reef", "ribbon",
  "river", "robin", "rocket", "saddle", "saffron", "salmon", "sapphire", "satin",
  "scarf", "shadow", "shell", "silver", "sketch", "sled", "slipper", "socket",
  "sparrow", "spider", "spruce", "squash", "stone", "stream", "sugar", "summit",
  "sunset", "swallow", "tango", "teapot", "thistle", "thunder", "tiger", "timber",
  "toast", "tomato", "topaz", "torch", "tulip", "tundra", "turtle", "umbrella",
  "valley", "velvet", "violet", "violin", "volcano", "waffle", "walnut", "walrus",
  "wander", "willow", "window", "winter", "wizard", "wombat", "yarrow", "yogurt",
  "zebra", "zephyr", "zinnia", "badger", "basin", "blanket", "bramble", "cashew",
  "clay", "cloud", "cocoa", "cradle", "dove", "elm", "feather", "fig",
  "harp", "jade", "kite", "lark", "lime", "loom", "lynx", "mesa",
  "oak", "pear", "quail", "sage", "tide", "wren", "yak", "zest",
] as const;

/** A uniformly random integer in [0, bound), bound <= 2^32, from the
 * platform's cryptographic source. Rejection sampling: no modulo bias. */
function randomBelow(bound: number): number {
  const limit = Math.floor(0x1_0000_0000 / bound) * bound;
  const sample = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(sample);
    const value = sample[0] as number;
    if (value < limit) {
      return value % bound;
    }
  }
}

/** Three words and a two-digit number, hyphenated: "harbor-plum-kite-41".
 * Always longer than the 12-character minimum. */
export function generateTemporaryPassword(): string {
  const words = [0, 1, 2].map(() => WORDS[randomBelow(WORDS.length)] as string);
  const number = 10 + randomBelow(90);
  return [...words, String(number)].join("-");
}
