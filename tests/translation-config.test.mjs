import test from 'node:test'
import assert from 'node:assert/strict'
import {configuredTranslationEndpoint,DEFAULT_TRANSLATION_API_URL} from '../config/translation.ts'

test('本机和Pages空变量都连接已确认的Worker，同一地址提供给前端与CSP',()=>{
  assert.equal(DEFAULT_TRANSLATION_API_URL,'https://cijing-translation.220719tt.workers.dev/translate')
  for(const value of [undefined,'','   '])assert.equal(configuredTranslationEndpoint(value),DEFAULT_TRANSLATION_API_URL)
  assert.equal(new URL(configuredTranslationEndpoint('')).origin,'https://cijing-translation.220719tt.workers.dev')
})
test('显式服务覆盖仍须通过HTTPS及无密钥参数校验',()=>{
  assert.equal(configuredTranslationEndpoint(' https://other.example/translate '),'https://other.example/translate')
  for(const value of ['http://other.example/translate','https://other.example/translate?key=secret','https://user:secret@other.example/translate'])assert.throws(()=>configuredTranslationEndpoint(value))
})
