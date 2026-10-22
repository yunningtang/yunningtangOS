import { setCookie, COOKIE } from '../_lib.js';

export default async function handler(req, res) {
  setCookie(res, COOKIE, '', { maxAge: 0 });
  res.statusCode = 302;
  res.setHeader('Location', '/#/settings');
  res.end();
}
