/** Fixed, non-sensitive error categories. Never persist a model's raw output. */
export const modelErrors:Record<string,string>={
  MODEL_OUTPUT_INVALID:'模型输出为空、过大或被截断。',
  MODEL_JSON_INVALID:'模型未返回有效 JSON。',
  MODEL_ALIGNMENT_INVALID:'模型译文与原文句组不对应或未通过英文校验。',
  MODEL_GLOSSARY_INVALID:'模型人物译名或术语表未通过校验。',
}
export const modelOutputReasons:Record<string,string>={TOKEN_LIMIT:'输出达到长度上限',EMPTY_OUTPUT:'模型输出为空',OUTPUT_SHAPE:'返回结构错误',OUTPUT_LIMIT:'输出超过安全上限',INCOMPLETE_THINK_BLOCK:'思考标记未闭合',EXTRA_OUTPUT:'包含译文以外的说明',UNBALANCED_DIALOGUE:'对话引号未闭合',INVALID_JSON:'JSON 格式不完整',SEGMENT_COUNT:'返回句组数量不符',SEGMENT_IDS:'返回句组编号不符',TARGET_VALIDATION:'英文内容未通过校验',GLOSSARY:'人物术语不符',NAME_SPELLING:'人物译名不一致'}
export const checkedModelReason=(value:unknown)=>typeof value==='string'&&Object.hasOwn(modelOutputReasons,value)?value:undefined
export class TranslationRequestError extends Error {
  readonly code:string
  readonly status:number
  readonly retryAfter:number
  readonly reason?:string
  constructor(code:string,message:string,status=0,retryAfter=0,reason?:string){super(message);this.name='TranslationRequestError';this.code=code;this.status=status;this.retryAfter=retryAfter;this.reason=checkedModelReason(reason)}
}
export function recoverable(error:unknown):error is TranslationRequestError {
  return error instanceof TranslationRequestError&&Object.hasOwn(modelErrors,error.code)
}
export function skippable(error:unknown):error is TranslationRequestError {
  return recoverable(error)||error instanceof TranslationRequestError&&['HTTP_502','HTTP_504','REQUEST_TIMEOUT'].includes(error.code)
}
export const failureReasons:Record<string,string>={...modelErrors,HTTP_502:'本次服务未返回可验证的译文，已跳过。',HTTP_504:'本次服务响应超时，已跳过。',REQUEST_TIMEOUT:'本次翻译超时，已跳过，不自动重发。',REQUEST_BUDGET:'本轮请求达到安全上限，此范围未请求，保留中文。',RECOVERY_BUDGET:'旧任务达到恢复上限，此范围保留中文，不自动重试。',SOURCE_TOO_LONG:'原文单句超过服务安全上限，未强行拆句；请保留中文或导入对应译文。'}
