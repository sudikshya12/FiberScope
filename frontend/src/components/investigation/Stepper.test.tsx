import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Stepper } from './Stepper'

describe('Stepper', () => {
  it('announces failed verification in text, not only color', () => {
    render(<Stepper status="verification_failed" />)
    expect(screen.getByText('Verify: failed')).toBeInTheDocument()
    expect(screen.getByText('Repair: complete')).toBeInTheDocument()
  })
  it('an abandoned drill shows no completed steps', () => {
    render(<Stepper status="abandoned" />)
    expect(screen.queryByText(/: complete$/)).toBeNull()
  })
})
