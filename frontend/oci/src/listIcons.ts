/** The emojis offered as List emojis, grouped for scanning.
 *
 * A curated set rather than the whole Unicode table: every entry should be
 * plausible as the emoji of a List of tasks. Names are the picker's accessible
 * labels, so they must stay unique across all groups. */

import { type IconGroup } from "./components/IconPicker";

export const LIST_ICON_GROUPS: readonly IconGroup[] = [
  {
    name: "Work",
    icons: [
      { name: "briefcase", emoji: "💼" },
      { name: "office building", emoji: "🏢" },
      { name: "laptop", emoji: "💻" },
      { name: "chart", emoji: "📈" },
      { name: "clipboard", emoji: "📋" },
      { name: "pushpin", emoji: "📌" },
      { name: "envelope", emoji: "✉️" },
      { name: "telephone", emoji: "📞" },
      { name: "handshake", emoji: "🤝" },
      { name: "rocket", emoji: "🚀" },
    ],
  },
  {
    name: "Home",
    icons: [
      { name: "house", emoji: "🏠" },
      { name: "broom", emoji: "🧹" },
      { name: "laundry", emoji: "🧺" },
      { name: "toolbox", emoji: "🧰" },
      { name: "hammer and wrench", emoji: "🛠️" },
      { name: "light bulb", emoji: "💡" },
      { name: "potted plant", emoji: "🪴" },
      { name: "key", emoji: "🔑" },
      { name: "package", emoji: "📦" },
      { name: "paw prints", emoji: "🐾" },
    ],
  },
  {
    name: "Shopping",
    icons: [
      { name: "shopping cart", emoji: "🛒" },
      { name: "shopping bags", emoji: "🛍️" },
      { name: "groceries", emoji: "🥑" },
      { name: "bread", emoji: "🥖" },
      { name: "gift", emoji: "🎁" },
      { name: "credit card", emoji: "💳" },
      { name: "receipt", emoji: "🧾" },
      { name: "money bag", emoji: "💰" },
    ],
  },
  {
    name: "Personal",
    icons: [
      { name: "star", emoji: "⭐" },
      { name: "heart", emoji: "❤️" },
      { name: "sparkles", emoji: "✨" },
      { name: "target", emoji: "🎯" },
      { name: "calendar", emoji: "📅" },
      { name: "alarm clock", emoji: "⏰" },
      { name: "party popper", emoji: "🎉" },
      { name: "family", emoji: "👪" },
      { name: "birthday cake", emoji: "🎂" },
      { name: "sun", emoji: "☀️" },
    ],
  },
  {
    name: "Health",
    icons: [
      { name: "running", emoji: "🏃" },
      { name: "weightlifting", emoji: "🏋️" },
      { name: "salad", emoji: "🥗" },
      { name: "pill", emoji: "💊" },
      { name: "stethoscope", emoji: "🩺" },
      { name: "sleep", emoji: "😴" },
      { name: "yoga", emoji: "🧘" },
      { name: "green apple", emoji: "🍏" },
    ],
  },
  {
    name: "Learning",
    icons: [
      { name: "books", emoji: "📚" },
      { name: "memo", emoji: "📝" },
      { name: "student", emoji: "🎓" },
      { name: "brain", emoji: "🧠" },
      { name: "magnifying glass", emoji: "🔍" },
      { name: "globe", emoji: "🌍" },
      { name: "artist palette", emoji: "🎨" },
      { name: "musical notes", emoji: "🎵" },
    ],
  },
  {
    name: "Travel",
    icons: [
      { name: "airplane", emoji: "✈️" },
      { name: "suitcase", emoji: "🧳" },
      { name: "car", emoji: "🚗" },
      { name: "world map", emoji: "🗺️" },
      { name: "beach", emoji: "🏖️" },
      { name: "mountain", emoji: "⛰️" },
      { name: "camping tent", emoji: "🏕️" },
      { name: "camera", emoji: "📷" },
    ],
  },
];
