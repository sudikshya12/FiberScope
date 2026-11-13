import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import { LoadingBlock } from './components/ui'
import { AppShell } from './components/AppShell'
const About = lazy(() => import('./pages/About'))
const Home = lazy(() => import('./pages/Home'))
const LabPage = lazy(() => import('./pages/Lab'))
const Scenarios = lazy(() => import('./pages/Scenarios'))
const Investigations = lazy(() => import('./pages/Investigations'))
const InvestigationPage = lazy(() => import('./pages/InvestigationPage'))
const DevicePage = lazy(() => import('./pages/Device'))
const Cables = lazy(() => import('./pages/Cables'))
const Optics = lazy(() => import('./pages/Optics'))
const Report = lazy(() => import('./pages/Report'))
const Learn = lazy(() => import('./pages/Learn'))
const SettingsPage = lazy(() => import('./pages/Settings'))
const Present = lazy(() => import('./pages/Present'))
const NotFound = lazy(() => import('./pages/NotFound'))

export default function App() {
  return (
    <Suspense fallback={<div className="p-8"><LoadingBlock rows={5} label="Loading page" /></div>}>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Home />} />
        <Route path="workbench" element={<LabPage />} />
        <Route path="lab" element={<LabPage />} />
        <Route path="scenarios" element={<Scenarios />} />
        <Route path="investigations" element={<Investigations />} />
        <Route path="investigations/:id" element={<InvestigationPage />} />
        <Route path="devices/:id" element={<DevicePage />} />
        <Route path="cables" element={<Cables />} />
        <Route path="optics" element={<Optics />} />
        <Route path="reports/:id" element={<Report />} />
        <Route path="learn" element={<Learn />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="about" element={<About />} />
        <Route path="present" element={<Present />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
    </Suspense>
  )
}
