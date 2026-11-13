import clsx from 'clsx'
import { BookMarked, Tag, TagsIcon, UserPen } from 'lucide-react'
import type { Cable } from '../../lib/types'
import { Badge } from '../ui'
import { OPERATOR_SOURCE } from './model'

/** Where a cable record came from: seeded documented inventory vs operator entry. */
export function ProvenanceBadge({ source, className, short }: { source?: string; className?: string; short?: boolean }) {
  const op = source === OPERATOR_SOURCE
  return (
    <span
      title={op ? 'Operator-entered record — added through this UI; not verified against the physical plant' : 'Documented inventory (seed fixture) — the modeled lab plant of record'}
      className={clsx(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold leading-4',
        op ? 'border-[#d9cfe6] bg-white text-ink' : 'border-line bg-canvas text-muted',
        className,
      )}
    >
      {op ? <UserPen className="size-3" aria-hidden /> : <BookMarked className="size-3" aria-hidden />}
      {op ? (short ? 'Operator' : 'Operator-entered') : short ? 'Seed' : 'Documented · seed'}
    </span>
  )
}

export function LabelBadge({ status }: { status: Cable['label_status'] }) {
  if (status === 'labeled')
    return (
      <span className="inline-flex items-center gap-1 whitespace-nowrap text-[11.5px] font-medium text-muted">
        <Tag className="size-3 text-faint" aria-hidden /> Labeled
      </span>
    )
  if (status === 'missing')
    return (
      <Badge tone="warn">
        <TagsIcon className="size-3" aria-hidden /> Missing
      </Badge>
    )
  return (
    <Badge tone="crit">
      <TagsIcon className="size-3" aria-hidden /> Mismatch
    </Badge>
  )
}
