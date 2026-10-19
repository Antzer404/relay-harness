import type { FileDiff } from '@shared/events'

const MODE_LABEL: Record<FileDiff['mode'], string> = {
  create: '新建',
  edit: '修改',
  write: '写入'
}

/**
 * Red/green is reserved for diff content only; the card chrome stays neutral.
 */
export function DiffView({ diff }: { diff: FileDiff }): React.JSX.Element {
  return (
    <div className="rly-diff">
      <div className="rly-diff-head">
        <span className={`rly-diff-mode is-${diff.mode}`}>{MODE_LABEL[diff.mode]}</span>
        <span className="rly-diff-path" title={diff.path}>
          {diff.path}
        </span>
        <span className="rly-diff-stat">
          <span className="is-add">+{diff.added}</span>
          <span className="is-del">−{diff.removed}</span>
        </span>
      </div>

      {diff.hunks.length === 0 ? (
        <p className="rly-diff-empty">
          {diff.truncated ? '改动过大，未渲染逐行 diff。' : '没有可显示的逐行改动。'}
        </p>
      ) : (
        <div className="rly-diff-body">
          {diff.hunks.map((hunk, hunkIndex) => (
            <div className="rly-diff-hunk" key={hunkIndex}>
              {hunkIndex > 0 ? <div className="rly-diff-gap">⋯</div> : null}
              {hunk.lines.map((line, lineIndex) => (
                <div className={`rly-diff-line is-${line.kind}`} key={lineIndex}>
                  <span className="rly-diff-no">{line.oldNo ?? ''}</span>
                  <span className="rly-diff-no">{line.newNo ?? ''}</span>
                  <span className="rly-diff-mark">
                    {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ''}
                  </span>
                  <span className="rly-diff-text">{line.text || ' '}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {diff.truncated && diff.hunks.length > 0 ? (
        <p className="rly-diff-note">diff 已截断，仅显示前一部分改动。</p>
      ) : null}
    </div>
  )
}
