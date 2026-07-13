import { useState } from 'react'

// Remembers a table's current page across route changes (list → open a row → back),
// which otherwise snaps back to page 1 because the list page unmounts and antd's
// pagination state resets. Keyed by a stable id; module-level so it survives navigation
// but resets on app reload.
const pages = new Map<string, number>()

export function useTablePage(key: string): { current: number; onChange: (page: number) => void } {
  const [current, setCurrent] = useState(() => pages.get(key) ?? 1)
  return {
    current,
    onChange: (page: number): void => {
      pages.set(key, page)
      setCurrent(page)
    }
  }
}
