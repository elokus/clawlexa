import type { ConfigFieldDescriptor, ProviderConfigSchema } from '../../lib/voice-config-api';
import { SettingsSection, SettingsField } from '../settings/SettingsSection';

interface ProviderSettingsSectionProps {
  schema: ProviderConfigSchema;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  group: 'vad' | 'advanced' | 'audio';
  title?: string;
  description?: string;
}

function isFieldVisible(
  field: ConfigFieldDescriptor,
  values: Record<string, unknown>
): boolean {
  if (!field.dependsOn) return true;
  return values[field.dependsOn.field] === field.dependsOn.value;
}

function resolveValue(values: Record<string, unknown>, key: string, defaultValue?: string | number | boolean): string | number | boolean {
  const val = values[key];
  if (val !== undefined && val !== null) return val as string | number | boolean;
  return defaultValue ?? '';
}

function FieldRenderer({
  field,
  values,
  onChange,
}: {
  field: ConfigFieldDescriptor;
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const value = resolveValue(values, field.key, field.defaultValue);

  switch (field.type) {
    case 'select':
      return (
        <SettingsField label={field.label} hint={field.description}>
          <select
            value={String(value)}
            onChange={(e) => onChange(field.key, e.target.value)}
          >
            {(field.options ?? []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingsField>
      );

    case 'boolean':
      return (
        <SettingsField label={field.label} hint={field.description}>
          <select
            value={value === true || value === 'true' ? 'true' : 'false'}
            onChange={(e) => onChange(field.key, e.target.value === 'true')}
          >
            <option value="false">disabled</option>
            <option value="true">enabled</option>
          </select>
        </SettingsField>
      );

    case 'number':
      return (
        <SettingsField label={field.label} hint={field.description}>
          <input
            type="number"
            value={value === '' ? '' : Number(value)}
            min={field.min}
            max={field.max}
            step={field.step ?? 1}
            onChange={(e) => {
              const num = Number(e.target.value);
              onChange(field.key, Number.isFinite(num) ? num : field.defaultValue ?? 0);
            }}
          />
        </SettingsField>
      );

    case 'range':
      return (
        <SettingsField label={`${field.label}: ${value}`} hint={field.description}>
          <input
            type="range"
            value={Number(value)}
            min={field.min ?? 0}
            max={field.max ?? 1}
            step={field.step ?? 0.01}
            onChange={(e) => onChange(field.key, Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </SettingsField>
      );

    case 'string':
    default:
      return (
        <SettingsField label={field.label} hint={field.description}>
          <input
            type="text"
            value={String(value)}
            onChange={(e) => onChange(field.key, e.target.value)}
          />
        </SettingsField>
      );
  }
}

export function ProviderSettingsSection({
  schema,
  values,
  onChange,
  group,
  title,
  description,
}: ProviderSettingsSectionProps) {
  const visibleFields = schema.fields.filter(
    (f) => f.group === group && isFieldVisible(f, values)
  );

  if (visibleFields.length === 0) return null;

  const sectionTitle = title ?? (group === 'vad' ? 'Voice Activity Detection' : group === 'advanced' ? 'Advanced Settings' : 'Audio');
  const sectionDesc = description ?? `${schema.displayName} ${group} configuration.`;

  return (
    <SettingsSection title={sectionTitle} description={sectionDesc} columns={3}>
      {visibleFields.map((field) => (
        <FieldRenderer
          key={field.key}
          field={field}
          values={values}
          onChange={onChange}
        />
      ))}
    </SettingsSection>
  );
}
