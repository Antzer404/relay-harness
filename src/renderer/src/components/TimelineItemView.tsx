import type { TimelineItem } from '@shared/timeline'
import { UserRow } from './items/UserRow'
import { AssistantText } from './items/AssistantText'
import { ThinkingBlock } from './items/ThinkingBlock'
import { ToolCard } from './items/ToolCard'
import { PermissionCard } from './items/PermissionCard'
import { ErrorBanner } from './items/ErrorBanner'
import { NoticeRow } from './items/NoticeRow'

/** Renders one leaf timeline row; shared by the timeline and process groups. */
export function TimelineItemView({ item }: { item: TimelineItem }): React.JSX.Element | null {
  switch (item.kind) {
    case 'user':
      return <UserRow item={item} />
    case 'text':
      return <AssistantText item={item} />
    case 'thinking':
      return <ThinkingBlock item={item} />
    case 'tool':
      return <ToolCard item={item} />
    case 'permission':
      return <PermissionCard item={item} />
    case 'error':
      return <ErrorBanner item={item} />
    case 'notice':
      return <NoticeRow item={item} />
  }
}
