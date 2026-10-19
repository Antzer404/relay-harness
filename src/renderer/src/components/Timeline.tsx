import { useEffect, useRef } from 'react'
import { useRelayStore, type TimelineItem } from '../store/useRelayStore'
import { UserRow } from './items/UserRow'
import { AssistantText } from './items/AssistantText'
import { ThinkingBlock } from './items/ThinkingBlock'
import { ToolCard } from './items/ToolCard'
import { PermissionCard } from './items/PermissionCard'
import { ErrorBanner } from './items/ErrorBanner'
import { NoticeRow } from './items/NoticeRow'
import { IconSpark } from './icons'

function renderItem(item: TimelineItem): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return <UserRow key={item.id} item={item} />
    case 'text':
      return <AssistantText key={item.id} item={item} />
    case 'thinking':
      return <ThinkingBlock key={item.id} item={item} />
    case 'tool':
      return <ToolCard key={item.id} item={item} />
    case 'permission':
      return <PermissionCard key={item.id} item={item} />
    case 'error':
      return <ErrorBanner key={item.id} item={item} />
    case 'notice':
      return <NoticeRow key={item.id} item={item} />
  }
}

const STARTERS = [
  '查看当前目录，简要说明这个项目在做什么',
  '找出最近修改过的文件，并解释这些改动',
  '写一个小脚本完成一件具体的事，然后运行它'
]

function Welcome(): React.JSX.Element {
  const setDraft = useRelayStore((state) => state.setDraft)
  const hasKey = useRelayStore((state) => state.bootstrap?.hasApiKey ?? false)

  return (
    <div className="rly-welcome">
      <div className="rly-welcome-mark" aria-hidden="true">
        <IconSpark size={22} />
      </div>
      <h1 className="rly-welcome-title">开始一项工作</h1>
      <p className="rly-welcome-sub">
        {hasKey
          ? '描述你想完成的事。思考过程、工具调用和结果会按顺序出现在这里。'
          : '先在设置中保存 DeepSeek API Key，然后就可以开始。'}
      </p>
      {hasKey ? (
        <div className="rly-starters">
          {STARTERS.map((text) => (
            <button
              key={text}
              type="button"
              className="rly-starter"
              onClick={() => {
                setDraft(text)
                window.dispatchEvent(new CustomEvent('relay:focus-composer'))
              }}
            >
              {text}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function Timeline(): React.JSX.Element {
  const items = useRelayStore((state) => state.items)
  const phase = useRelayStore((state) => state.phase)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const node = scrollRef.current
    if (!node || !stick.current) return
    node.scrollTop = node.scrollHeight
  }, [items, phase])

  return (
    <section
      className="rly-timeline"
      ref={scrollRef}
      onScroll={(event) => {
        const node = event.currentTarget
        stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 140
      }}
    >
      {items.length === 0 ? (
        <Welcome />
      ) : (
        <div className="rly-items">{items.map(renderItem)}</div>
      )}
      {phase === 'busy' || phase === 'starting' ? (
        <div className="rly-running" aria-label="模型正在工作">
          <span className="rly-running-dot" />
          <span className="rly-running-dot" />
          <span className="rly-running-dot" />
        </div>
      ) : null}
    </section>
  )
}
