import jwt from 'jsonwebtoken';

export async function authenticationMiddleware(req, res, next) {
  try {
    let token = req.headers.authorization || req.query.token;

    if (!token) {
      return res.status(401).json({ error: 'not authenticated' });
    }

    if (token.startsWith('Bearer ')) {
      token = token.slice(7);
    }

    const { accountId, userId, backToUrl, shortLivedToken } = jwt.verify(
      token,
      process.env.MONDAY_SIGNING_SECRET
    );

    req.session = { userId, accountId, shortLivedToken, backToUrl };
    next();
  } catch (err) {
    res.status(401).json({ error: 'not authenticated' });
  }
}
