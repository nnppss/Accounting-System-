import { describe, expect, it } from 'vitest'
import {
  contraNarration,
  nextNarration,
  paymentNarration,
  receiptNarration
} from './narration'

describe('narration builders', () => {
  it('names the counterparty and tag', () => {
    expect(receiptNarration('Ramesh')).toBe('Received from Ramesh')
    expect(receiptNarration('Ramesh', 'Rent')).toBe('Received from Ramesh (Rent)')
    expect(paymentNarration('Suresh')).toBe('Paid to Suresh')
    expect(contraNarration('Cash', 'HDFC')).toBe('Transfer Cash → HDFC')
  })
  it('yields nothing until the key field is picked', () => {
    expect(receiptNarration(undefined)).toBe('')
    expect(contraNarration('Cash', undefined)).toBe('')
  })
})

describe('nextNarration (auto vs manual)', () => {
  it('fills an empty box', () => {
    expect(nextNarration('', '', 'Received from Ramesh')).toBe('Received from Ramesh')
  })
  it('updates while the box still holds the last suggestion', () => {
    expect(nextNarration('Received from Ramesh', 'Received from Ramesh', 'Paid to Suresh')).toBe(
      'Paid to Suresh'
    )
  })
  it('backs off once the user has edited', () => {
    expect(nextNarration('Received from Ramesh — advance', 'Received from Ramesh', 'x')).toBeNull()
  })
})
