import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // graphql-js identifies its own types with an instanceof check that fails
    // when the package is loaded twice, which is what happens by default here:
    // Vite transforms the test file's import while Node's loader handles
    // Pothos's. Routing both through Vite leaves exactly one instance.
    server: { deps: { inline: ['graphql', '@pothos/core'] } },
  },
})
