import { Link, useParams } from 'react-router'
import { useInvestigation, useInvestigations, useTopology } from '../lib/hooks'
import { Workbench } from '../components/investigation/Workbench'
import { Button, EmptyState, ErrorState, LoadingBlock } from '../components/ui'
import { ApiError } from '../lib/api'

export default function InvestigationPage() {
  const { id } = useParams()
  const topo = useTopology()
  const inv = useInvestigation(id)
  const list = useInvestigations()
  if (inv.error instanceof ApiError && inv.error.status === 404)
    return (
      <EmptyState title={`Investigation ${id} not found`} action={<Link to="/investigations"><Button>All investigations</Button></Link>}>
        It may belong to a different database.
      </EmptyState>
    )
  if (topo.error || inv.error) return <div className="p-6"><ErrorState error={topo.error ?? inv.error} onRetry={() => { topo.refetch(); inv.refetch() }} /></div>
  if (!topo.data || !inv.data) return <div className="p-6"><LoadingBlock rows={6} label="Loading investigation" /></div>
  return <Workbench topo={topo.data} inv={inv.data} investigations={list.data?.investigations} />
}
