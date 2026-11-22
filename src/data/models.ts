import type { UserVocabulary } from '../userVocabulary.ts'
import type { LearningState } from '../learningState.ts'
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type AppData = { vocabulary: UserVocabulary; learning: LearningState; favorites: number[] }
export type IdentityMap = { nextId: number; localToCloud: Record<number,string> }
export type Cells = Record<string,Json>
export type CloudSnapshot = { revision: number; cells: Cells }
export type Change = { key: string; before: Json; after: Json }
export type OperationKind = 'vocabulary' | 'delete' | 'bulk-delete' | 'restore' | 'clear-user' | 'reset-progress' | 'clear-all' | 'favorite' | 'learned' | 'preferences' | 'start' | 'draft' | 'submit' | 'assess' | 'migration' | 'archive' | 'ai-complete' | 'review-request'
export type ErrorCategory = 'transient' | 'auth' | 'permanent' | 'conflict' | 'storage'
export type Operation = { id: string; protocol?: 2|3|4|5; learningEpoch?:number; kind: OperationKind; at: number; notBefore?:number; undoLabel?:string; changes: Change[]; status: 'pending' | 'processing' | 'failed' | 'conflict'; message?: string; expectedRevision?: number; migrationId?: string; attempted?:boolean; retryCount?:number; lastAttemptAt?:number; nextRetryAt?:number; errorCategory?:ErrorCategory; blockedBy?:string; wirePayload?:Json }
export type SyncCache = { version: 4 | 5 | 6; quarantine?:{value:unknown;reason:string}[]; selections?:{daily?:string;review?:string}; identities: IdentityMap; migrationIdentities?: IdentityMap; base: CloudSnapshot; queue: Operation[]; backups: Operation[]; initialized: boolean; migrationChoice?: 'account' | 'imported' }
export interface CloudTransport { pull(): Promise<CloudSnapshot>; reconcile?(ids:string[]):Promise<{accepted:string[];snapshot:CloudSnapshot}>; compactDrafts?(operations:Operation[]):Promise<{accepted:string[];snapshot:CloudSnapshot}>; push(operation: Operation): Promise<{ conflict: boolean; snapshot: CloudSnapshot; message?: string }> }
// Deep, key-order-insensitive equality: two values are equal when their sorted-key
// JSON forms match (undefined counts as null, as JSON array slots do).
//
// Performance: this used to build a canonical JSON string for BOTH whole values,
// re-stringifying and re-parsing at every nesting level, and accounted for ~77% of
// CPU per Daily Test action (saveLearning compares the entire learning state, which
// includes every archived session). This structural walk gives the same answers but
// returns at the first difference and skips subtrees shared by reference, which
// immutable state updates keep for almost all unchanged data.
export const equal = (a: unknown,b: unknown): boolean => {
  if (a === b) return true
  const arrayA = Array.isArray(a), arrayB = Array.isArray(b)
  if (arrayA || arrayB) {
    if (!arrayA || !arrayB || a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false
    return true
  }
  const objectA = !!a && typeof a === 'object', objectB = !!b && typeof b === 'object'
  if (objectA || objectB) {
    if (!objectA || !objectB) return false
    const left = a as Record<string, unknown>, right = b as Record<string, unknown>, keys = Object.keys(left)
    if (keys.length !== Object.keys(right).length) return false
    for (const key of keys) if (!Object.prototype.propertyIsEnumerable.call(right, key) || !equal(left[key], right[key])) return false
    return true
  }
  if (typeof a === 'string' && typeof b === 'string') return false // a !== b already
  return primitiveJson(a) === primitiveJson(b) // e.g. undefined≡null, NaN≡null, as in JSON
}
const primitiveJson = (value: unknown) => JSON.stringify(value ?? null) ?? 'null'
export const json = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json
export const newId = () => crypto.randomUUID()
