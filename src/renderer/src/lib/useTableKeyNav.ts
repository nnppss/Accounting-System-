import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function isModalOpen(): boolean {
  for (const el of document.querySelectorAll('.ant-modal-wrap')) {
    if ((el as HTMLElement).style.display !== 'none') return true
  }
  return false
}

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
      if (isInputFocused() || isModalOpen()) return
      const items = dataRef.current
      if (!items || items.length === 0) return

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setActiveIndex((prev) => Math.min(prev + 1, items.length - 1))
          break
        case 'ArrowUp':
          e.preventDefault()
          setActiveIndex((prev) => Math.max(prev - 1, 0))
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
      if (isInputFocused() || isModalOpen()) return
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
