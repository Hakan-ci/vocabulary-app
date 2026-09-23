/** Only application-owned messages may be shown; never display backend/provider text. */
export class PracticeProviderError extends Error {}
export function practiceResponseError(value:unknown):PracticeProviderError{
  const code=value&&typeof value==='object'?(value as {error?:unknown}).error:null
  const message=code==='invalid_output'
    ? 'The tutor returned feedback that could not be validated. No learning results were saved. You can retry this action or end practice for fresh feedback.'
    :code==='limit_or_duplicate'
    ? 'This request was blocked by a practice limit or duplicate-request check. Repeated retries may not help. Return to practice and try later.'
    :code==='authentication_required'
    ? 'Please sign in again before starting a new practice session.'
    :code==='timeout'
    ? 'The tutor took too long to respond. You can retry this action; retrying may use the pilot budget.'
    : 'The tutor is unavailable. You can retry this action; retrying may use the pilot budget.'
  return new PracticeProviderError(message)
}
