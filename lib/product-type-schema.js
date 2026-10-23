import crypto from 'node:crypto';
import { request } from './http.js';

// PTD schema links are supplied by Amazon, not by the change request.
export async function officialSchema(definition) {
  const resource = definition?.schema?.link?.resource;
  let url;
  try { url = new URL(resource); } catch { throw new Error('Product Type Definitions 未返回 schema 下载地址。'); }
  if (url.protocol !== 'https:' || url.username || url.password || !/(^|\.)(amazonaws\.com|amazon\.com)$/.test(url.hostname)) throw new Error('PTD schema 地址不是受支持的 Amazon HTTPS 地址。');
  const response = await request(url.href, { raw: true });
  const text = await response.text();
  if (text.length > 8 * 1024 * 1024) throw new Error('PTD schema 超过 8 MB，停止提案。');
  if (definition.schema.checksum && crypto.createHash('md5').update(text).digest('base64') !== definition.schema.checksum) throw new Error('PTD schema 校验和不一致，请重新查询。');
  return JSON.parse(text);
}
