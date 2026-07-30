import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // graphql-js identifies its own types with an instanceof check that fails
    // when the package is loaded twice, which is the default here: Vite
    // transforms the test file's imports while Node's loader handles the copies
    // reached through Pothos, Yoga and Envelop. Routing everything that holds a
    // graphql reference through Vite leaves exactly one instance.
    //
    // The narrow list this started as (graphql, @pothos/core) was enough while
    // only the schema was under test. It stopped being enough the moment a test
    // went through Yoga, and the symptom was every resolver error coming back as
    // INTERNAL_SERVER_ERROR rather than as itself.
    server: { deps: { inline: [/graphql/, /@pothos/, /@envelop/, /@whatwg-node/] } },

    // One mongod for the whole run instead of one per suite. Seven suites
    // starting their own in parallel is what made the startup flaky; the file
    // explains the failure it removes, and `testing/database.ts` explains what
    // now keeps the suites apart.
    globalSetup: ['./src/testing/globalMongod.ts'],
  },
})
