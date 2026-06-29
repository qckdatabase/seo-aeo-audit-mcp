// MCP `z.any()` params can arrive as JSON strings — some clients stringify large
// pass-through objects. Coerce to an object so downstream code gets real fields.
export function parseArg<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}
