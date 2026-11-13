import { expect, test, type APIRequestContext, type Page } from '@playwright/test'

const API = 'http://127.0.0.1:8078/api'

async function create(request: APIRequestContext, key: string, opts: { baseline?: boolean; fault?: boolean } = {}) {
  const inv = await (await request.post(`${API}/investigations`, { data: { scenario_key: key } })).json()
  if (opts.baseline) await request.post(`${API}/investigations/${inv.id}/baseline`)
  if (opts.fault) await request.post(`${API}/investigations/${inv.id}/inject-fault`)
  return inv.id as string
}

async function diag(request: APIRequestContext, id: string, action: string, target: object, params: object = {}) {
  return (await (await request.post(`${API}/investigations/${id}/diagnostics`, { data: { action, target, params } })).json()).evidence.id as string
}

async function openTool(page: Page, name: 'Run check' | 'Case notes' | 'Repair & verify') {
  await page.getByRole('button', { name: 'Report' }).first().waitFor() // investigation loaded
  const asideBtn = page.locator('aside').getByRole('button', { name, exact: true })
  if (await asideBtn.count()) await asideBtn.click()
  else await page.getByRole('group', { name: 'Investigation tools' }).getByRole('button', { name }).click()
}

async function runAction(page: Page, label: string, selects: Record<string, string> = {}) {
  await openTool(page, 'Run check')
  await page.getByRole('button', { name: new RegExp(label) }).click()
  const item = page.locator('li').filter({ has: page.getByRole('button', { name: new RegExp(label) }) })
  for (const [id, value] of Object.entries(selects)) await item.locator(`#${id}`).selectOption(value)
  await item.getByRole('button', { name: 'Run', exact: true }).click()
}

test('complete the wrong-VLAN investigation in the workbench', async ({ page, request }) => {
  const id = await create(request, 'wrong-vlan')
  await page.goto(`/investigations/${id}`)
  await page.getByRole('button', { name: 'Capture baseline' }).click()
  await expect(page.getByText('Baseline reviewed').first()).toBeVisible()
  await page.getByRole('button', { name: 'Introduce fault' }).click()
  await expect(page.getByText(/cannot reach Server B/).first()).toBeVisible()

  await runAction(page, 'Check reachability')
  await expect(page.getByRole('heading', { name: /Reachability srv-a → srv-b/ }).first()).toBeVisible()
  await runAction(page, 'Inspect interface state', { 't-interface_state-interface': 'asw-2:Ethernet1/1' })
  await expect(page.getByRole('heading', { name: 'Interface state — asw-2:Ethernet1/1' }).first()).toBeVisible()
  await runAction(page, 'Inspect VLAN membership', { 't-vlan_membership-device': 'asw-2' })
  await expect(page.getByRole('heading', { name: 'VLAN membership — asw-2' }).first()).toBeVisible()

  await openTool(page, 'Case notes')
  await page.locator('#diag-cat').selectOption('l2_vlan')
  await page.locator('#diag-stmt').fill('asw-2 Ethernet1/1 runs access VLAN 30; intended 20. Link up both ends; ARP fails.')
  await page.locator('label').filter({ hasText: 'VLAN membership — asw-2' }).locator('input').check()
  await page.locator('label').filter({ hasText: 'Interface state — asw-2:Ethernet1/1' }).locator('input').check()
  await page.locator('aside').getByRole('button', { name: 'Record diagnosis' }).click()
  await expect(page.getByText('Recorded diagnosis')).toBeVisible()

  await openTool(page, 'Repair & verify')
  await page.locator('#rep-action').selectOption('set_access_vlan')
  await page.locator('#rep-target').selectOption('asw-2:Ethernet1/1')
  await page.locator('#rep-vlan').selectOption('20')
  await page.getByRole('button', { name: 'Apply corrective action' }).click()
  await expect(page.getByText(/Set access VLAN on asw-2:Ethernet1\/1: 30 → 20/).first()).toBeVisible()
  // a repair alone must not resolve
  await expect(page.getByRole('button', { name: 'Resolve investigation' })).toBeDisabled()
  await page.getByRole('button', { name: 'Run verification', exact: true }).click()
  await expect(page.getByText(/All checks passed/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Resolve investigation' }).click()
  await expect(page.getByText('Resolved with evidence')).toBeVisible()
  await expect(page.getByText(/your diagnosis matched/)).toBeVisible()
})

test('fail verification, investigate further, then recover (optical)', async ({ page, request }) => {
  const id = await create(request, 'low-rx-power', { baseline: true, fault: true })
  const ev = await diag(request, id, 'optical_telemetry', { interface: 'asw-1:Ethernet1/1' })
  await request.post(`${API}/investigations/${id}/diagnosis`, { data: { category: 'optical_path_degraded', statement: 'Low Rx toward asw-1 Eth1/1', evidence_ids: [ev] } })
  await page.goto(`/investigations/${id}`)
  await openTool(page, 'Repair & verify')
  // wrong (but plausible) repair first: swap the optic
  await page.locator('#rep-action').selectOption('replace_optic')
  await page.locator('#rep-target').selectOption('asw-1:Ethernet1/1')
  await page.getByRole('button', { name: 'Apply corrective action' }).click()
  await page.getByRole('button', { name: 'Run verification', exact: true }).click()
  await expect(page.getByText(/checks failed/).first()).toBeVisible()
  await expect(page.getByText('Verification failed').first()).toBeVisible()
  // additional investigation: scope inspection along the path
  await runAction(page, 'Inspect connector end-face', { 't-connector_inspection-location': 'pp-02:F01' })
  await expect(page.getByRole('heading', { name: 'Connector inspection — pp-02:F01' })).toBeVisible()
  await expect(page.getByText('Investigating').first()).toBeVisible()
  await openTool(page, 'Repair & verify')
  await page.locator('#rep-action').selectOption('clean_connector')
  await page.locator('#rep-target').selectOption('pp-02:F01')
  await page.getByRole('button', { name: 'Apply corrective action' }).click()
  await page.getByRole('button', { name: 'Run verification', exact: true }).click()
  await expect(page.getByText(/All checks passed/).first()).toBeVisible()
  await page.getByRole('button', { name: 'Resolve investigation' }).click()
  await expect(page.getByText('Resolved with evidence')).toBeVisible()
})

test('complete the optical investigation through the guided demonstration', async ({ page }) => {
  await page.goto('/present?story=optical')
  const steps = ['Capture baseline', 'Introduce fault', 'Read optical telemetry', null, 'Trace documented path', 'Inspect asw-1 port, then PP-02 F01', 'Record diagnosis', 'Clean PP-02 F01', 'Verify & resolve']
  for (const label of steps) {
    if (label) {
      await page.getByRole('button', { name: label, exact: true }).click()
      await expect(page.getByText('Step performed')).toBeVisible()
    }
    if (label === 'Read optical telemetry') await expect(page.getByText(/below this module's low-warning threshold/).first()).toBeVisible()
    if (label !== 'Verify & resolve') await page.getByRole('button', { name: 'Next' }).click()
  }
  await expect(page.getByText(/All checks passed/)).toBeVisible()
  await expect(page.getByText('Resolved').first()).toBeVisible()
})

test('refresh preserves investigation state', async ({ page, request }) => {
  const id = await create(request, 'mtu-mismatch', { baseline: true, fault: true })
  await page.goto(`/investigations/${id}`)
  await runAction(page, 'Run MTU probe')
  await expect(page.getByRole('heading', { name: /MTU probe srv-a → srv-b/ }).first()).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: /^Evidence/ }).click()
  const tray = page.getByRole('region', { name: 'evidence tray' })
  await expect(tray.getByRole('heading', { name: /MTU probe srv-a → srv-b/ })).toHaveCount(2) // baseline + investigation
  await expect(page.getByText('Investigating').first()).toBeVisible()
})

test('restart a simulation without deleting other history', async ({ page, request }) => {
  const id = await create(request, 'packet-loss', { baseline: true, fault: true })
  await diag(request, id, 'reachability', { src: 'srv-a', dst: 'srv-b' }, { count: 100 })
  await page.goto(`/investigations/${id}`)
  await page.getByRole('button', { name: 'More investigation actions' }).click()
  await page.getByRole('menuitem', { name: 'Restart as new drill' }).click()
  await expect(page).not.toHaveURL(new RegExp(`/investigations/${id}$`))
  const list = await (await request.get(`${API}/investigations`)).json()
  const old = list.investigations.find((i: { id: string }) => i.id === id)
  expect(old.status).toBe('abandoned')
  const detail = await (await request.get(`${API}/investigations/${id}`)).json()
  expect(detail.evidence.length).toBeGreaterThan(3)
})

test('export a report (JSON and CSV) with provenance', async ({ page, request }) => {
  const id = await create(request, 'admin-down', { baseline: true, fault: true })
  const ev = await diag(request, id, 'interface_state', { interface: 'asw-1:Ethernet1/1' })
  await request.post(`${API}/investigations/${id}/diagnosis`, { data: { category: 'admin_state', statement: 'asw-1 Eth1/1 admin down', evidence_ids: [ev] } })
  await request.post(`${API}/investigations/${id}/repairs`, { data: { action: 'enable_interface', target: { interface: 'asw-1:Ethernet1/1' }, params: {} } })
  await request.post(`${API}/investigations/${id}/verify`)
  await request.post(`${API}/investigations/${id}/resolve`, { data: {} })
  await page.goto(`/reports/${id}`)
  await expect(page.getByText(/SIMULATED/).first()).toBeVisible()
  await expect(page.getByText(/No lessons recorded by the operator/)).toBeVisible()
  const [json] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /JSON/ }).click()])
  expect(json.suggestedFilename()).toMatch(new RegExp(`^fiberscope-${id}(-report)?\\.json$`))
  const [csv] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: /CSV/ }).click()])
  expect(csv.suggestedFilename()).toBe(`fiberscope-${id}-measurements.csv`)
  const body = await (await request.get(`${API}/reports/${id}`)).json()
  expect(body.scenario.source_mode).toBe('SIMULATED')
  expect(body.evidence.every((e: { content_sha256: string }) => e.content_sha256.length === 64)).toBe(true)
})

test('topology is interactive: trace path shows a text equivalent', async ({ page }) => {
  await page.goto('/lab')
  const region = page.getByRole('region', { name: /Network topology/ })
  await expect(region.getByText('PP-01', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Trace path' }).click()
  await page.getByRole('button', { name: 'Text path' }).click()
  await expect(region.getByText(/srv-a eth0 → CBL-F101 → pp-01 F01/)).toBeVisible()
  // selecting a device opens the contextual inspector; closing it restores the wide canvas
  await page.locator('.react-flow__node').filter({ hasText: 'Server A' }).click()
  await expect(page.getByRole('heading', { name: 'Server A', level: 3 })).toBeVisible()
  await page.getByRole('button', { name: 'Close panel' }).click()
  await expect(page.getByRole('heading', { name: 'Server A', level: 3 })).toHaveCount(0)
  // list view alternative
  await page.getByRole('radio', { name: /List/ }).click()
  await expect(page.getByRole('heading', { name: /Path srv-a → srv-b/ })).toBeVisible()
  await page.getByRole('radio', { name: /Graph/ }).click()
  await page.getByRole('radio', { name: 'Logical' }).click()
  await expect(page.getByRole('region', { name: /Network topology, logical/ }).getByText('PP-01', { exact: true })).toHaveCount(0)
})
