import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './api'
import type { Investigation } from './types'

export const qk = {
  topology: ['topology'] as const,
  catalog: ['catalog'] as const,
  scenarios: ['scenarios'] as const,
  investigations: ['investigations'] as const,
  investigation: (id: string) => ['investigation', id] as const,
  profile: ['profile'] as const,
  lab: ['lab'] as const,
  health: ['health'] as const,
}

export const useTopology = () => useQuery({ queryKey: qk.topology, queryFn: api.topology, staleTime: 60_000 })
export const useCatalog = () => useQuery({ queryKey: qk.catalog, queryFn: api.catalog, staleTime: 60_000 })
export const useScenarios = () => useQuery({ queryKey: qk.scenarios, queryFn: api.scenarios, staleTime: 60_000 })
export const useInvestigations = () => useQuery({ queryKey: qk.investigations, queryFn: api.investigations })
export const useProfile = () => useQuery({ queryKey: qk.profile, queryFn: api.profile })
export const useHealth = () => useQuery({ queryKey: qk.health, queryFn: api.health, refetchInterval: 15_000, retry: 0 })

export function useInvestigation(id: string | undefined) {
  const qc = useQueryClient()
  const q = useQuery({ queryKey: qk.investigation(id ?? ''), queryFn: () => api.investigation(id!), enabled: !!id })
  const [live, setLive] = useState(false)
  // Server-sent events: refetch the investigation when the backend records new audit events.
  const loaded = !!q.data
  useEffect(() => {
    // Live updates via SSE; disabled on serverless hosting (VITE_ENABLE_SSE=false), where mutations refresh the cache directly.
    if (!id || !loaded || typeof EventSource === 'undefined' || import.meta.env.VITE_ENABLE_SSE === 'false') return
    const cached = qc.getQueryData<Investigation>(qk.investigation(id))
    const after = Math.max(0, ...(cached?.timeline ?? []).map((t) => t.id))
    const es = new EventSource(`/api/investigations/${id}/events?after=${after}`)
    es.onopen = () => setLive(true)
    es.onerror = () => setLive(false)
    es.addEventListener('audit', () => {
      qc.invalidateQueries({ queryKey: qk.investigation(id) })
    })
    return () => es.close()
  }, [id, qc, loaded])
  return { ...q, live }
}

/** Wrap a mutation that returns the updated investigation and write it into the cache. */
export function useInvMutation<TArgs>(id: string | undefined, fn: (args: TArgs) => Promise<Investigation | { investigation: Investigation }>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (data) => {
      const inv = 'investigation' in data ? data.investigation : data
      if (id) qc.setQueryData(qk.investigation(id), inv)
      qc.invalidateQueries({ queryKey: qk.investigations })
    },
  })
}
