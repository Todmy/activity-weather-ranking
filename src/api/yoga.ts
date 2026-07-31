import type { ValidationRule } from 'graphql'
import { createYoga } from 'graphql-yoga'
import { defaultQuery, defaultTabs } from './graphiql.ts'
import { limitRootFields } from './rootFields.ts'
import { schema } from './schema.ts'
import type { GraphQLContext } from './schema.ts'

/**
 * The HTTP app, built here rather than in `index.ts` so that tests exercise the
 * same instance the deployed service runs.
 *
 * That distinction is not academic. Yoga masks any error that is not a
 * `GraphQLError` as "Unexpected error." with an INTERNAL_SERVER_ERROR code,
 * which `graphql()` on its own does not do — so a resolver error can pass a
 * schema test and still reach a reviewer as a blank 500. It did, until this
 * file existed.
 */
export type AppOptions = Omit<GraphQLContext, 'release'> &
  Partial<Pick<GraphQLContext, 'release'>> & {
    /** One line per request. Injected so a test can read it instead of stdout. */
    log?: (line: string) => void
  }

/**
 * What a request left behind, as one line of JSON on stdout.
 *
 * `status` alone would report every failure this service has as a success:
 * GraphQL answers 200 with an `errors` array, so the count is the part that
 * matters. The operation name comes from the document rather than from the path,
 * because every request here goes to `/graphql` and a path-based access log
 * would distinguish nothing.
 */
type RequestLog = {
  msg: 'request'
  operation: string
  status: number
  errors: number
  durationMs: number
}

const NAMED_OPERATION = /(?:query|mutation)\s+([A-Za-z_][A-Za-z0-9_]*)/

const operationOf = (body: string): string => {
  try {
    const { operationName, query } = JSON.parse(body) as {
      operationName?: string
      query?: string
    }
    if (typeof operationName === 'string' && operationName.length > 0) return operationName
    return NAMED_OPERATION.exec(query ?? '')?.[1] ?? 'anonymous'
  } catch {
    return 'unparsed'
  }
}

const errorsIn = (body: string): number => {
  try {
    const parsed = JSON.parse(body) as { errors?: unknown[] }
    return Array.isArray(parsed.errors) ? parsed.errors.length : 0
  } catch {
    return 0
  }
}

export const createApp = ({ deps, release = 'unknown', log = console.log }: AppOptions) => {
  /**
   * A plugin rather than a wrapper around `fetch`.
   *
   * `createServer(createApp(...))` hands the app to Node as a request listener,
   * and that path does not go through `fetch` — a wrapper there would log
   * everything a test does and nothing the deployed service does, which is the
   * shape of bug this project has already shipped once. Yoga's hooks sit under
   * both transports.
   */
  const startedAt = new WeakMap<Request, number>()

  return createYoga({
    schema,
    graphqlEndpoint: '/graphql',
    graphiql: { title: 'Activity weather ranking', defaultQuery, defaultTabs },
    // Off, not permissive. Yoga's default reflects whatever Origin arrives and
    // adds allow-credentials, which with no cookies and no auth leaks nothing —
    // but it lets any page drive its readers' browsers at this endpoint from as
    // many addresses as it has readers. Nothing legitimate needs it: GraphiQL
    // is served from this origin, and curl has never heard of CORS.
    cors: false,
    context: () => ({ deps, release }),
    plugins: [
      {
        onValidate({
          addValidationRule,
        }: {
          addValidationRule: (rule: ValidationRule) => void
        }) {
          addValidationRule(limitRootFields)
        },
        onRequest({ request }) {
          startedAt.set(request, performance.now())
        },
        async onResponse({ request, response }) {
          // GraphiQL's own asset fetches are a browser loading an editor, and a
          // log they drown out is a log nobody reads.
          if (request.method !== 'POST') return

          const body = await response.clone().text()
          const entry: RequestLog = {
            msg: 'request',
            operation: operationOf(await request.clone().text()),
            status: response.status,
            errors: errorsIn(body),
            durationMs: Math.round(performance.now() - (startedAt.get(request) ?? 0)),
          }

          log(JSON.stringify(entry))
        },
      },
    ],
  })
}
