import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type UIEvent
} from 'react'
import type { TimelineItem } from '@shared/timeline'
import {
  buildLayout,
  estimateItemHeight,
  findFirstVisible,
  findVisibleRange,
  type TimelineLayout
} from '../lib/timeline-layout'

export const TIMELINE_GAP = 16
const OVERSCAN_PX = 600
const STICK_THRESHOLD_PX = 160
const DEFAULT_VIEWPORT = 900

export interface VirtualTimeline {
  layout: TimelineLayout
  /** First rendered row index. */
  start: number
  /** Exclusive end of the rendered window. */
  end: number
  /** True when the user scrolled away from the tail. */
  detached: boolean
  /** Ref factory for each rendered row; pass the item id so it can be measured. */
  registerRow: (id: string) => (node: HTMLDivElement | null) => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  scrollToBottom: () => void
}

interface Anchor {
  id: string
  /** Distance between the scroll viewport top and the anchor row top. */
  topInView: number
}

const EMPTY_LAYOUT: TimelineLayout = { ids: [], offsets: [], heights: [], total: 0 }

/**
 * Windowed rendering for the conversation timeline.
 *
 * Variable-height rows (streaming markdown, diff cards, collapsible tool
 * output) rule out a fixed row size, so every mounted row is measured with a
 * ResizeObserver and the measurement is cached by item id. Unmeasured rows
 * fall back to cheap estimates. When a row above the viewport changes height
 * while the user is reading history, the scroll position is re-anchored on the
 * topmost visible row so content does not jump; while the user sits at the
 * tail, the view is pinned to the bottom so streaming stays visible.
 */
export function useVirtualTimeline(options: {
  items: TimelineItem[]
  scrollRef: RefObject<HTMLDivElement | null>
  /** Changing this (session id) resets scroll position to the bottom. */
  resetKey: string | null
}): VirtualTimeline {
  const { items, scrollRef, resetKey } = options

  const heights = useRef(new Map<string, number>())
  const layoutRef = useRef<TimelineLayout>(EMPTY_LAYOUT)
  const stickRef = useRef(true)
  const pendingAnchor = useRef<Anchor | null>(null)
  const nodes = useRef(new Map<string, HTMLDivElement>())
  const callbacks = useRef(new Map<string, (node: HTMLDivElement | null) => void>())
  const observerRef = useRef<ResizeObserver | null>(null)
  const flushRef = useRef(0)

  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(0)
  const [version, setVersion] = useState(0)
  const [detached, setDetached] = useState(false)

  const layout = useMemo(() => {
    const ids = items.map((item) => item.id)
    const sizes = items.map((item) => heights.current.get(item.id) ?? estimateItemHeight(item))
    return buildLayout(ids, sizes, TIMELINE_GAP)
    // `version` bumps after measurements land; `items` rebuilds the row list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, version])

  const scheduleLayoutBump = useCallback(() => {
    if (flushRef.current) return
    flushRef.current = window.requestAnimationFrame(() => {
      flushRef.current = 0
      const node = scrollRef.current
      if (node && !stickRef.current) {
        const prev = layoutRef.current
        const index = findFirstVisible(prev.offsets, prev.heights, node.scrollTop)
        const id = prev.ids[index]
        if (id) {
          pendingAnchor.current = {
            id,
            topInView: node.scrollTop - (prev.offsets[index] ?? 0)
          }
        }
      }
      setVersion((value) => value + 1)
    })
  }, [scrollRef])

  const recordHeight = useCallback(
    (id: string, height: number) => {
      const prev = heights.current.get(id)
      if (prev !== undefined && Math.abs(prev - height) < 0.5) return
      if (heights.current.size > 20_000) heights.current.clear()
      heights.current.set(id, height)
      scheduleLayoutBump()
    },
    [scheduleLayoutBump]
  )

  const registerRow = useCallback(
    (id: string) => {
      const existing = callbacks.current.get(id)
      if (existing) return existing
      const callback = (node: HTMLDivElement | null): void => {
        const previous = nodes.current.get(id)
        if (previous && previous !== node) {
          observerRef.current?.unobserve(previous)
          nodes.current.delete(id)
        }
        if (!node) return
        nodes.current.set(id, node)
        observerRef.current?.observe(node)
        const height = node.getBoundingClientRect().height
        if (height > 0) recordHeight(id, height)
      }
      callbacks.current.set(id, callback)
      return callback
    },
    [recordHeight]
  )

  // One observer for every mounted row. Rows are added/removed by the ref
  // callback above, so this effect only needs to exist once per mount.
  useLayoutEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const node = entry.target as HTMLElement
        const id = node.dataset.itemId
        if (!id) continue
        const height = entry.borderBoxSize?.[0]?.blockSize ?? node.getBoundingClientRect().height
        recordHeight(id, height)
      }
    })
    observerRef.current = observer
    for (const node of nodes.current.values()) observer.observe(node)
    return () => {
      observer.disconnect()
      observerRef.current = null
      if (flushRef.current) window.cancelAnimationFrame(flushRef.current)
      flushRef.current = 0
    }
  }, [recordHeight])

  // Track the visible height of the scroll container (window resizes, sidebar
  // toggles) and keep the tail pinned after a resize.
  useLayoutEffect(() => {
    const node = scrollRef.current
    if (!node) return
    setViewport(node.clientHeight)
    const observer = new ResizeObserver(() => {
      setViewport(node.clientHeight)
      if (stickRef.current) node.scrollTop = node.scrollHeight
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [scrollRef])

  // Jump to the tail when the session changes, regardless of where the
  // previous session was left.
  useLayoutEffect(() => {
    stickRef.current = true
    setDetached(false)
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    setScrollTop(node.scrollTop)
  }, [resetKey, scrollRef])

  // Apply the layout to the DOM: re-anchor on measured height changes while
  // detached, otherwise stay pinned to the bottom.
  useLayoutEffect(() => {
    layoutRef.current = layout
    const node = scrollRef.current
    if (!node) return
    if (!stickRef.current) {
      const anchor = pendingAnchor.current
      pendingAnchor.current = null
      if (anchor) {
        const index = layout.ids.indexOf(anchor.id)
        if (index >= 0) node.scrollTop = (layout.offsets[index] ?? 0) + anchor.topInView
      }
      return
    }
    pendingAnchor.current = null
    node.scrollTop = node.scrollHeight
  }, [layout, scrollRef])

  const onScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    const node = event.currentTarget
    const atBottom = node.scrollHeight - node.scrollTop - node.clientHeight < STICK_THRESHOLD_PX
    if (atBottom !== stickRef.current) {
      stickRef.current = atBottom
      setDetached(!atBottom)
    }
    // While pinned the rendered window ignores `scrollTop`, so skipping the
    // state write avoids a second render for every streaming delta.
    if (!atBottom) setScrollTop(node.scrollTop)
  }, [])

  const scrollToBottom = useCallback(() => {
    stickRef.current = true
    setDetached(false)
    const node = scrollRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    setScrollTop(node.scrollTop)
  }, [scrollRef])

  const range = useMemo(() => {
    const count = layout.heights.length
    if (count === 0) return { start: 0, end: 0 }
    // While pinned, the window is computed against the list's bottom edge so
    // the last rows render even if the stored scrollTop lags behind freshly
    // grown content.
    const height = viewport || DEFAULT_VIEWPORT
    const top = stickRef.current ? Math.max(0, layout.total - height) : scrollTop
    const visible = findVisibleRange(layout, top, height, OVERSCAN_PX)
    if (visible.start >= count) return { start: count - 1, end: count }
    return visible
    // `detached` participates because it flips together with stickRef.
  }, [layout, scrollTop, viewport, detached])

  return {
    layout,
    start: range.start,
    end: range.end,
    detached,
    registerRow,
    onScroll,
    scrollToBottom
  }
}
