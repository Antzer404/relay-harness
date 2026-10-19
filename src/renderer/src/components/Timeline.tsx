import { useEffect, useRef } from 'react'
import { useRelayStore, type TimelineItem } from '../store/useRelayStore'
import { clock, dateStamp, number } from '../lib/format'
import { UserRow } from './items/UserRow'
import { AssistantText } from './items/AssistantText'
import { ThinkingBlock } from './items/ThinkingBlock'
import { ToolCard } from './items/ToolCard'
import { ErrorBanner } from './items/ErrorBanner'
import { NoticeRow } from './items/NoticeRow'

function renderItem(item: TimelineItem): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return <UserRow key={item.id} item={item} />
    case 'text':
      return <AssistantText key={item.id} item={item} />
    case 'thinking':
      return <ThinkingBlock key={item.id} item={item} />
    case 'tool':
      return <ToolCard key={item.id} item={item} />
    case 'error':
      return <ErrorBanner key={item.id} item={item} />
    case 'notice':
      return <NoticeRow key={item.id} item={item} />
  }
}

export function Timeline(): React.JSX.Element {
  const items = useRelayStore((state) => state.items)
  const session = useRelayStore((state) => state.session)
  const phase = useRelayStore((state) => state.phase)
  const usage = useRelayStore((state) => state.usage)
  const scrollRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const node = scrollRef.current
    if (!node || !stick.current) return
    node.scrollTop = node.scrollHeight
  }, [items, phase])

  return (
    <section className="ef-timeline">
      <header className="ef-section-head">
        <div>
          <div className="ef-eyebrow">
            <span className="ef-label">TRANSCRIPT</span>
          </div>
          <h2 className="ef-title-cn">时间线</h2>
        </div>
        <div className="ef-section-fields">
          <span className="ef-num">{String(items.length).padStart(3, '0')} 条记录</span>
          <span className="ef-sep">│</span>
          <span className="ef-num">{dateStamp(session?.startedAt ?? Date.now())}</span>
          <span className="ef-sep">│</span>
          <span className="ef-num">
            {usage ? `${number(usage.contextTokens)} CTX` : 'NO USAGE'}
          </span>
        </div>
      </header>

      <div
        className="ef-timeline-scroll"
        ref={scrollRef}
        onScroll={(event) => {
          const node = event.currentTarget
          stick.current = node.scrollHeight - node.scrollTop - node.clientHeight < 140
        }}
      >
        {items.length === 0 ? (
          <div className="ef-empty">
            <div className="ef-empty-hatch" aria-hidden="true" />
            <div className="ef-empty-body">
              <div className="ef-label">EMPTY TRANSCRIPT</div>
              <p>
                发送第一条消息后，思维链、工具调用与成果会按发生顺序出现在这里。
              </p>
              {!session ? (
                <p className="ef-empty-sub">
                  当前还没有运行中的会话。先在右侧 SETUP 保存 DeepSeek API Key，再新建会话。
                </p>
              ) : (
                <p className="ef-empty-sub">
                  会话已就绪：{clock(session.startedAt)} 启动于 {session.cwd}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className="ef-items">{items.map(renderItem)}</div>
        )}
        {phase === 'busy' ? (
          <div className="ef-busy-line">
            <span className="ef-busy-block" aria-hidden="true" />
            <span className="ef-label">RUNNING</span>
          </div>
        ) : null}
      </div>
    </section>
  )
}
