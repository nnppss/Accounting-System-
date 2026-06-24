import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Empty, Select, Spin, Typography } from 'antd'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import type { AccountType } from '@shared/enums'

interface Option {
  value: number
  label: ReactNode
}

interface Props {
  /** Restrict the search to one account type (e.g. 'kisan'). */
  type?: AccountType
  /**
   * Append the account's type (Kisan/Vyapari/…) to each option, so a person with
   * more than one role-account (e.g. a kisan AND a vyapari ledger under the same
   * name) is distinguishable. Off by default to keep single-type pickers tidy.
   */
  showType?: boolean
  value?: number
  onChange?: (value: number | undefined) => void
  placeholder?: string
  allowClear?: boolean
  autoFocus?: boolean
  style?: CSSProperties
}

/**
 * A name-as-you-type account picker. Unlike a plain <Select> with a static
 * options list, this queries the backend (`accounts.list({ name })`) only once
 * the user has typed something (debounced), so it stays usable with thousands
 * of accounts — nothing is fetched until there's a search term, and only the
 * matching rows are ever rendered.
 */
export default function AccountSearchSelect({
  type,
  showType,
  value,
  onChange,
  placeholder,
  allowClear,
  autoFocus,
  style
}: Props): JSX.Element {
  const { t } = useTranslation()
  // Raw text in the box vs. the debounced term we actually query with.
  const [search, setSearch] = useState('')
  const [term, setTerm] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  // Remember the chosen option so its name keeps showing once the dropdown's
  // result set no longer contains it.
  const [selected, setSelected] = useState<Option | undefined>()

  useEffect(() => {
    if (value === undefined) setSelected(undefined)
  }, [value])

  const onSearch = (text: string): void => {
    setSearch(text)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setTerm(text.trim()), 250)
  }

  const query = useQuery({
    queryKey: ['accounts', type ?? 'all', 'search', term],
    queryFn: () => window.api.accounts.list({ type, name: term }),
    // Don't fetch anything until the user has typed — keeps the box light even
    // with thousands of accounts.
    enabled: term.length > 0
  })

  const options: Option[] = (query.data ?? []).map((a) => ({
    value: a.id,
    label: showType ? (
      <span>
        {a.name}{' '}
        <Typography.Text type="secondary">· {t(`accounts.type.${a.type}`)}</Typography.Text>
      </span>
    ) : (
      a.name
    )
  }))
  // Keep the current selection visible even when it's outside the latest results.
  if (selected && !options.some((o) => o.value === selected.value)) {
    options.unshift(selected)
  }

  return (
    <Select
      showSearch
      filterOption={false}
      value={value}
      searchValue={search}
      onSearch={onSearch}
      onChange={(v, option) => {
        setSelected(option as Option | undefined)
        // Reset the search so reopening the box starts fresh, not on the old term.
        setSearch('')
        setTerm('')
        onChange?.(v as number | undefined)
      }}
      placeholder={placeholder}
      allowClear={allowClear}
      autoFocus={autoFocus}
      style={style}
      options={options}
      loading={query.isFetching}
      notFoundContent={
        query.isFetching ? (
          <Spin size="small" />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={term.length === 0 ? t('common.typeToSearch') : t('common.noMatches')}
          />
        )
      }
    />
  )
}
