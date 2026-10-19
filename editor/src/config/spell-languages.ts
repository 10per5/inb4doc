/**
 * Opt-in dictionaries for the editor's writing assistance (spell-check
 * highlight). The app hands the selected tags to the browser via `lang` /
 * `spellcheck`, so only dictionaries the user's browser actually ships will
 * underline anything — hence "opt in": picking a language never installs it.
 */
export interface SpellLanguage {
  tag: string;
  label: string;
}

export const SPELL_LANGUAGES: SpellLanguage[] = [
  { tag: "en", label: "English" },
  { tag: "es", label: "Spanish" },
  { tag: "fr", label: "French" },
  { tag: "de", label: "German" },
  { tag: "it", label: "Italian" },
  { tag: "pt", label: "Portuguese" },
  { tag: "pt-BR", label: "Portuguese (Brazil)" },
  { tag: "nl", label: "Dutch" },
  { tag: "pl", label: "Polish" },
  { tag: "ru", label: "Russian" },
  { tag: "uk", label: "Ukrainian" },
  { tag: "tr", label: "Turkish" },
  { tag: "sv", label: "Swedish" },
  { tag: "nb", label: "Norwegian" },
  { tag: "da", label: "Danish" },
  { tag: "fi", label: "Finnish" },
  { tag: "cs", label: "Czech" },
  { tag: "ca", label: "Catalan" },
  { tag: "gl", label: "Galician" },
  { tag: "eu", label: "Basque" },
];

export function spellLanguageLabel(tag: string): string {
  return SPELL_LANGUAGES.find((l) => l.tag === tag)?.label ?? tag;
}
