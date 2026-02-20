import type { ProviderVoiceEntry } from '../../lib/voice-config-api';
import { ConfigField } from '../ui/config-dialog';

interface VoiceSelectorProps {
  label: string;
  voices: ProviderVoiceEntry[];
  value: string;
  onChange: (voiceId: string) => void;
  languageFilter?: string;
  hint?: string;
}

function matchesLanguage(voiceLang: string | undefined, filter: string): boolean {
  if (!voiceLang) return true; // show voices without language info
  const vl = voiceLang.toLowerCase();
  const fl = filter.toLowerCase();
  if (vl === fl) return true;
  if (vl === 'multi' || vl === 'multilingual') return true;
  // Fuzzy: "de" matches "de-DE", "de-AT", etc.
  if (vl.startsWith(fl) || fl.startsWith(vl)) return true;
  return false;
}

export function VoiceSelector({
  label,
  voices,
  value,
  onChange,
  languageFilter,
  hint,
}: VoiceSelectorProps) {
  let filtered = voices;
  if (languageFilter && languageFilter !== 'multi') {
    const matched = voices.filter((v) => matchesLanguage(v.language, languageFilter));
    // Fall back to full list if filter yields no results
    if (matched.length > 0) filtered = matched;
  }

  // Ensure current value is in the list
  const hasCurrent = filtered.some((v) => v.id === value);
  if (!hasCurrent && value) {
    filtered = [{ id: value, name: value }, ...filtered];
  }

  // Group by language for optgroups
  const languages = Array.from(new Set(filtered.map((v) => v.language ?? 'other')));
  const useGroups = languages.length > 1 && filtered.length > 6;

  return (
    <ConfigField label={label} hint={hint}>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {useGroups
          ? languages.map((lang) => (
              <optgroup key={lang} label={lang}>
                {filtered
                  .filter((v) => (v.language ?? 'other') === lang)
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                      {v.gender ? ` (${v.gender})` : ''}
                    </option>
                  ))}
              </optgroup>
            ))
          : filtered.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.language && v.language !== 'multi' ? ` (${v.language})` : ''}
                {v.gender ? ` [${v.gender}]` : ''}
              </option>
            ))}
      </select>
    </ConfigField>
  );
}
