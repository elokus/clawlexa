import { useEffect, useMemo, useState } from 'react';
import type { ProviderVoiceEntry } from '../../lib/voice-config-api';
import { SettingsField } from '../settings/SettingsSection';

interface VoiceSelectorProps {
  label: string;
  voices: ProviderVoiceEntry[];
  value: string;
  onChange: (voiceId: string) => void;
  languageFilter?: string;
  hint?: string;
}

function normalizeLanguageTag(tag: string): string {
  return tag.toLowerCase();
}

function matchesLanguage(voiceLang: string | undefined, filter: string): boolean {
  if (!voiceLang) return false;
  const vl = normalizeLanguageTag(voiceLang);
  const fl = filter.toLowerCase();
  if (vl === fl) return true;
  if (vl === 'multi' || vl === 'multilingual') return true;
  // Fuzzy: "de" matches "de-DE", "de-AT", etc.
  if (vl.startsWith(fl) || fl.startsWith(vl)) return true;
  return false;
}

function normalizeLanguage(value: string | undefined): string {
  if (!value) return '';
  return normalizeLanguageTag(value);
}

function voiceLabel(voice: ProviderVoiceEntry): string {
  const base = voice.name || voice.id;
  const lang = normalizeLanguage(voice.language);
  const genderSuffix = voice.gender ? ` [${voice.gender}]` : '';
  return lang ? `${base} - ${lang}${genderSuffix}` : `${base}${genderSuffix}`;
}

export function VoiceSelector({
  label,
  voices,
  value,
  onChange,
  languageFilter,
  hint,
}: VoiceSelectorProps) {
  const [selectedLanguage, setSelectedLanguage] = useState<string>(
    languageFilter && languageFilter !== 'multi' ? '__auto__' : '__all__'
  );
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    setSelectedLanguage(languageFilter && languageFilter !== 'multi' ? '__auto__' : '__all__');
  }, [languageFilter]);

  const availableLanguages = useMemo(
    () =>
      Array.from(
        new Set(
          voices
            .map((v) => normalizeLanguage(v.language))
            .filter((lang) => lang.length > 0)
        )
      ).sort((a, b) =>
        a.localeCompare(b)
      ),
    [voices]
  );

  const filtered = useMemo(() => {
    let result = voices;

    if (selectedLanguage === '__auto__' && languageFilter && languageFilter !== 'multi') {
      result = result.filter((v) => matchesLanguage(v.language, languageFilter));
    } else if (selectedLanguage !== '__all__' && selectedLanguage !== '__auto__') {
      result = result.filter((v) => matchesLanguage(v.language, selectedLanguage));
    }

    const normalizedSearch = searchTerm.trim().toLowerCase();
    if (normalizedSearch.length > 0) {
      result = result.filter((voice) => {
        const haystack = [
          voice.id,
          voice.name,
          voice.language,
          voice.gender,
        ]
          .filter((part): part is string => typeof part === 'string')
          .join(' ')
          .toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    }

    return result;
  }, [voices, selectedLanguage, languageFilter, searchTerm]);

  // Ensure current value is in the list.
  const withCurrent = useMemo(() => {
    const hasCurrent = filtered.some((v) => v.id === value);
    if (hasCurrent || !value) return filtered;
    const existing = voices.find((voice) => voice.id === value);
    return [
      existing ?? { id: value, name: value },
      ...filtered,
    ];
  }, [filtered, value, voices]);

  // Group by language for optgroups.
  const languages = useMemo(
    () =>
      Array.from(
        new Set(
          withCurrent
            .map((v) => normalizeLanguage(v.language))
            .filter((lang) => lang.length > 0)
        )
      ),
    [withCurrent]
  );
  const useGroups = languages.length > 1 && withCurrent.length > 6;
  const showFilters = voices.length > 10;
  const autoLanguageLabel =
    languageFilter && languageFilter !== 'multi' ? `Auto (${languageFilter})` : 'Auto';

  const voiceSelect = (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {useGroups
        ? languages.map((lang) => (
            <optgroup key={lang} label={lang}>
              {withCurrent
                .filter((v) => normalizeLanguage(v.language) === lang)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {voiceLabel(v)}
                  </option>
                ))}
            </optgroup>
          ))
        : withCurrent.map((v) => (
            <option key={v.id} value={v.id}>
              {voiceLabel(v)}
            </option>
          ))}
    </select>
  );

  if (!showFilters) {
    return (
      <SettingsField label={label} hint={hint}>
        {voiceSelect}
      </SettingsField>
    );
  }

  return (
    <SettingsField label={label} hint={hint} fullWidth>
      <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'minmax(100px, auto) minmax(120px, 1fr) minmax(0, 2fr)' }}>
        <select
          value={selectedLanguage}
          onChange={(event) => setSelectedLanguage(event.target.value)}
          aria-label="Filter voices by language"
        >
          {languageFilter && languageFilter !== 'multi' ? (
            <option value="__auto__">{autoLanguageLabel}</option>
          ) : null}
          <option value="__all__">All Languages</option>
          {availableLanguages.map((lang) => (
            <option key={lang} value={lang}>
              {lang}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={searchTerm}
          placeholder="Search voice, id, lang"
          onChange={(event) => setSearchTerm(event.target.value)}
          aria-label="Search voices"
        />
        {voiceSelect}
      </div>
    </SettingsField>
  );
}
