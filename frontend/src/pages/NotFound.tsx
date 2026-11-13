import { Link } from 'react-router'
import { Page } from '../components/AppShell'
import { Button, EmptyState } from '../components/ui'

export default function NotFound() {
  return (
    <Page>
      <EmptyState title="Page not found" action={<Link to="/"><Button>Back to overview</Button></Link>}>
        That route does not exist in FiberScope.
      </EmptyState>
    </Page>
  )
}
