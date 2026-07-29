/** The emojis offered as Habit icons, grouped for scanning.
 *
 * A curated set rather than the whole Unicode table: every entry should be
 * plausible as a Habit icon. Names are the picker's accessible labels, so
 * they must stay unique across all groups. */

export interface HabitIcon {
  name: string;
  emoji: string;
}

export interface HabitIconGroup {
  name: string;
  icons: readonly HabitIcon[];
}

export const HABIT_ICON_GROUPS: readonly HabitIconGroup[] = [
  {
    name: "Health",
    icons: [
      { name: "droplet", emoji: "💧" },
      { name: "apple", emoji: "🍎" },
      { name: "salad", emoji: "🥗" },
      { name: "pill", emoji: "💊" },
      { name: "sleep", emoji: "😴" },
      { name: "bed", emoji: "🛏️" },
      { name: "tooth", emoji: "🦷" },
      { name: "shower", emoji: "🚿" },
      { name: "herb", emoji: "🌿" },
      { name: "no smoking", emoji: "🚭" },
    ],
  },
  {
    name: "Fitness",
    icons: [
      { name: "running", emoji: "🏃" },
      { name: "weightlifting", emoji: "🏋️" },
      { name: "yoga", emoji: "🧘" },
      { name: "cycling", emoji: "🚴" },
      { name: "swimming", emoji: "🏊" },
      { name: "walking", emoji: "🚶" },
      { name: "hiking", emoji: "🥾" },
      { name: "football", emoji: "⚽" },
      { name: "stretching", emoji: "🤸" },
      { name: "flexed biceps", emoji: "💪" },
    ],
  },
  {
    name: "Mind",
    icons: [
      { name: "books", emoji: "📚" },
      { name: "writing", emoji: "✍️" },
      { name: "memo", emoji: "📝" },
      { name: "student", emoji: "🎓" },
      { name: "brain", emoji: "🧠" },
      { name: "laptop", emoji: "💻" },
      { name: "language", emoji: "🗣️" },
      { name: "lightbulb", emoji: "💡" },
      { name: "newspaper", emoji: "📰" },
      { name: "abacus", emoji: "🧮" },
    ],
  },
  {
    name: "Creative",
    icons: [
      { name: "artist palette", emoji: "🎨" },
      { name: "guitar", emoji: "🎸" },
      { name: "musical notes", emoji: "🎵" },
      { name: "camera", emoji: "📷" },
      { name: "theatre", emoji: "🎭" },
      { name: "microphone", emoji: "🎤" },
      { name: "sewing", emoji: "🧵" },
      { name: "video game", emoji: "🎮" },
    ],
  },
  {
    name: "Home",
    icons: [
      { name: "house", emoji: "🏠" },
      { name: "broom", emoji: "🧹" },
      { name: "soap", emoji: "🧼" },
      { name: "laundry", emoji: "🧺" },
      { name: "cooking", emoji: "🍳" },
      { name: "potted plant", emoji: "🪴" },
      { name: "dog", emoji: "🐕" },
      { name: "cat", emoji: "🐈" },
      { name: "recycling", emoji: "♻️" },
      { name: "toolbox", emoji: "🧰" },
    ],
  },
  {
    name: "Life",
    icons: [
      { name: "money", emoji: "💰" },
      { name: "telephone", emoji: "📞" },
      { name: "letter", emoji: "💌" },
      { name: "calendar", emoji: "📅" },
      { name: "sun", emoji: "☀️" },
      { name: "coffee", emoji: "☕" },
      { name: "tea", emoji: "🍵" },
      { name: "praying hands", emoji: "🙏" },
      { name: "sparkles", emoji: "✨" },
      { name: "target", emoji: "🎯" },
      { name: "seedling", emoji: "🌱" },
      { name: "star", emoji: "⭐" },
    ],
  },
];
