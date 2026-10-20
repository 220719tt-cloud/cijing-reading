import {translationEndpoint} from '../src/features/translation/automatic/protocol.ts'

// Public service URL, not a credential. Keep frontend and CSP on the same endpoint.
export const DEFAULT_TRANSLATION_API_URL='https://cijing-translation.220719tt.workers.dev/translate'
export const TRANSLATION_WEBSITE_ORIGIN='https://220719tt-cloud.github.io'
export function configuredTranslationEndpoint(value:string|undefined,development=false){
  return translationEndpoint(value?.trim()||DEFAULT_TRANSLATION_API_URL,development)
}
