import { describe, expect, it } from 'vitest'
import { graphql } from 'graphql'
import { schema } from './schema.ts'

describe('schema', () => {
  it('answers health without a server or a database', async () => {
    const result = await graphql({ schema, source: '{ health }' })

    expect(result.errors).toBeUndefined()
    expect(result.data).toEqual({ health: 'ok' })
  })
})
