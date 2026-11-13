import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { QRCodeSVG } from 'qrcode.react'
import { Printer, X } from 'lucide-react'
import type { Cable } from '../../lib/types'
import { Button } from '../ui'
import { KIND_LABEL, MEDIA_LABEL, fmtLen, labelUrl, splitEp } from './model'

function End({ side, id, connector }: { side: 'A' | 'B'; id: string | null; connector: string }) {
  const ep = splitEp(id)
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-4 shrink-0 font-mono text-[10px] font-bold text-[#68656f]">{side}</span>
      <div className="min-w-0">
        <div className="truncate font-mono text-[13px] font-semibold text-[#242329]">{ep ? `${ep.dev} ${ep.port}` : 'not recorded'}</div>
        <div className="truncate text-[10px] text-[#68656f]">{connector}</div>
      </div>
    </div>
  )
}

export function LabelCard({ c }: { c: Cable }) {
  const len = fmtLen(c.nominal_length_m)
  return (
    <div className="flex h-[1.9in] break-inside-avoid gap-3 rounded-lg border border-[#cfcad6] bg-white p-3 print:rounded-none print:border-[#242329]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#68656f]">{KIND_LABEL[c.kind] ?? c.kind}</span>
          {c.label_status !== 'labeled' && <span className="rounded bg-warn-soft px-1 text-[9px] font-semibold uppercase text-warn print:hidden">label {c.label_status}</span>}
        </div>
        <div className="font-mono text-[26px] font-bold leading-[1.05] tracking-tight text-[#242329]">{c.id}</div>
        <div className="mt-2 space-y-1 border-t border-dashed border-[#d3cfd9] pt-1.5">
          <End side="A" id={c.a} connector={c.connector_a} />
          <End side="B" id={c.b} connector={c.connector_b} />
        </div>
        <div className="mt-auto flex items-center gap-2 pt-1 text-[10.5px] text-[#242329]">
          <span className="font-semibold">{MEDIA_LABEL[c.media] ?? c.media}</span>
          {c.fiber_type && <span className="truncate text-[#68656f]">{c.fiber_type}</span>}
          <span className="ml-auto shrink-0 font-mono font-semibold">{len ?? 'len. unknown'}</span>
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-center justify-center gap-1">
        <QRCodeSVG value={labelUrl(c.id)} size={88} level="M" marginSize={0} />
        <span className="text-[8px] uppercase tracking-[0.1em] text-[#8a8692]">scan for record</span>
      </div>
    </div>
  )
}

/**
 * Full-screen, print-friendly label sheet. Rendered into <body> so the app
 * shell's fixed-height scroll container doesn't clip printed pages; while
 * mounted, a print stylesheet hides everything else.
 */
export function PrintLabels({ cables, onClose }: { cables: Cable[]; onClose: () => void }) {
  const [printed] = useState(() => new Date().toISOString().slice(0, 10))
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return createPortal(
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-label="Printable cable labels"
      className="fs-print-root fixed inset-0 z-50 overflow-y-auto bg-[#ebe8e4] scroll-thin print:static print:overflow-visible print:bg-white"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <style>{`@media print { body > *:not(.fs-print-root) { display: none !important; } html, body { height: auto !important; overflow: visible !important; background: #fff !important; } @page { margin: 12mm; } }`}</style>
      <div className="no-print sticky top-0 z-10 border-b border-line bg-panel">
        <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink">Print labels</div>
            <div className="text-[12.5px] text-muted">
              {cables.length} label{cables.length === 1 ? '' : 's'} · QR links to <span className="font-mono">{window.location.origin}/cables?id=…</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose} icon={<X className="size-4" />}>
              Close
            </Button>
            <Button variant="primary" onClick={() => window.print()} icon={<Printer className="size-4" />} autoFocus>
              Print
            </Button>
          </div>
        </div>
      </div>
      <motion.div
        className="mx-auto my-6 max-w-[8.5in] rounded-sm bg-white p-[0.4in] shadow-[var(--shadow-pop)] print:m-0 print:max-w-none print:p-0 print:shadow-none"
        initial={{ y: 14, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      >
        <div className="mb-3 flex items-baseline justify-between border-b border-[#e3dfe8] pb-2 text-[10px] text-[#68656f]">
          <span className="font-semibold uppercase tracking-[0.12em] text-[#242329]">FiberScope · cable labels</span>
          <span>Modeled lab inventory · printed {printed}</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 print:grid-cols-2">
          {cables.map((c) => (
            <LabelCard key={c.id} c={c} />
          ))}
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  )
}
