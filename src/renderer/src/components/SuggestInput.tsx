import { AutoComplete } from 'antd'
import { useQuery } from '@tanstack/react-query'

type PersonField = 'villageCity' | 'state' | 'sonOf'

/** Title-case each word: first letter upper, rest lower ("ram KUMAR" → "Ram Kumar"). */
export const titleCase = (s: string): string =>
  s.replace(/\S+/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase())

/**
 * Free-text input that suggests values already saved for this person field
 * (e.g. every village/city typed before). Substring match, case-insensitive.
 * Drop-in for AntD <Input/> inside a Form.Item — value/onChange come from the form.
 */
export function SuggestInput({
  field,
  value,
  onChange
}: {
  field: PersonField
  value?: string
  onChange?: (v: string) => void
}): JSX.Element {
  const { data } = useQuery({
    queryKey: ['personFieldValues', field],
    queryFn: () => window.api.persons.fieldValues(field),
    staleTime: 60_000
  })
  // Suggest-as-you-type: no dropdown on empty focus, prefix match once the user types.
  // Dedupe case-insensitively here too (main process doesn't hot-reload in dev).
  const q = value?.trim().toLowerCase() ?? ''
  const seen = new Set<string>()
  const options = q
    ? (data ?? []).flatMap((raw) => {
        const v = raw.trim()
        const key = v.toLowerCase()
        if (!key.startsWith(q) || seen.has(key)) return []
        seen.add(key)
        return [{ value: v }]
      })
    : []
  return (
    <AutoComplete
      value={value}
      onChange={(v) => onChange?.(titleCase(v))}
      options={options}
      filterOption={false}
    />
  )
}
