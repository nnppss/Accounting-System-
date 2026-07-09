import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { isInputFocused, isNavFocused, isOverlayOpen } from './keyGuards'

export function useTableKeyNav<T>(
  data: T[] | undefined,
  onActivate: (record: T, index: number) => void
): {
  activeIndex: number
  containerRef: RefObject<HTMLDivElement>
  rowClassName: (record: T, index: number) => string
} {
  const [activeIndex, setActiveIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null) as RefObject<HTMLDivElement>
  const onActivateRef = useRef(onActivate)
  onActivateRef.current = onActivate
  const dataRef = useRef(data)
  dataRef.current = data

  const len = data?.length ?? 0
  useEffect(() => setActiveIndex(-1), [len])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (isInputFocused() || isOverlayOpen() || isNavFocused()) return
      const items = dataRef.current
      if (!items || items.length === 0) return

      const last = items.length - 1
      // Jump roughly one screenful at a time for PageUp/PageDown.
      const PAGE = 10

      switch (e.key) {
        case 'ArrowDown':
          // First press (nothing selected) lands on the top row.
          e.preventDefault()
          setActiveIndex((prev) => Math.min(prev + 1, last))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((prev) => (prev < 0 ? last : Math.max(prev - 1, 0)))
          break
        case 'Home':
          e.preventDefault()
          setActiveIndex(0)
          break
        case 'End':
          e.preventDefault()
          setActiveIndex(last)
          break
        case 'PageDown':
          e.preventDefault()
          setActiveIndex((prev) => Math.min((prev < 0 ? 0 : prev) + PAGE, last))
          break
        case 'PageUp':
          e.preventDefault()
          setActiveIndex((prev) => Math.max((prev < 0 ? 0 : prev) - PAGE, 0))
          break
        case 'Escape':
          setActiveIndex(-1)
          break
      }
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if (isInputFocused() || isOverlayOpen() || isNavFocused()) return
      if (e.key !== 'Enter') return
      const items = dataRef.current
      if (!items || activeIndex < 0 || activeIndex >= items.length) return
      e.preventDefault()
      onActivateRef.current(items[activeIndex], activeIndex)
    }

    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeIndex])

  useEffect(() => {
    if (activeIndex < 0 || !containerRef.current) return
    const rows = containerRef.current.querySelectorAll(
      '.ant-table-tbody > tr.ant-table-row'
    )
    rows[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const rowClassName = useCallback(
    (_: T, index: number) => (index === activeIndex ? 'pc-row-active' : ''),
    [activeIndex]
  )

  return { activeIndex, containerRef, rowClassName }
}
