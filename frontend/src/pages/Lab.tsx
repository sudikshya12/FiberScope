import { useSearchParams } from 'react-router'
import { useInvestigation, useInvestigations, useTopology } from '../lib/hooks'
import { Workbench } from '../components/investigation/Workbench'
import { ErrorState, LoadingBlock } from '../components/ui'

/** /lab — the network workbench. Shows the most recent active investigation (or ?investigation=ID),
 *  otherwise the documented inventory with nothing observed. */
export default function LabPage() {
  const [params] = useSearchParams()
  const topo = useTopology()
  const list = useInvestigations()
  const active = list.data?.investigations.find((i) => i.status !== 'resolved' && i.status !== 'abandoned')
  const id = params.get('investigation') ?? active?.id
  const inv = useInvestigation(id ?? undefined)
  if (topo.error) return <div className="p-6"><ErrorState error={topo.error} onRetry={() => topo.refetch()} /></div>
  if (!topo.data || list.isLoading || (id && inv.isLoading)) return <div className="p-6"><LoadingBlock rows={6} label="Loading workbench" /></div>
  return <Workbench topo={topo.data} inv={inv.data} investigations={list.data?.investigations} />
}
