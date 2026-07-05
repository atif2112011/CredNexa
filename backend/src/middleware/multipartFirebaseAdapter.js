import { Readable } from "stream";

const cloneRequestForRawBodyParsing = (req) => {
  const rawBody = Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody || []);
  const stream = Readable.from(rawBody);

  stream.headers = req.headers;
  stream.method = req.method;
  stream.url = req.url;
  stream.originalUrl = req.originalUrl;
  stream.httpVersion = req.httpVersion;
  stream.httpVersionMajor = req.httpVersionMajor;
  stream.httpVersionMinor = req.httpVersionMinor;
  stream.rawHeaders = req.rawHeaders;
  stream.trailers = req.trailers;
  stream.rawTrailers = req.rawTrailers;
  stream.socket = req.socket;

  return stream;
};

export const runMultipartParser = ({ req, res, upload, next, onAfterParse }) => {
  const shouldUseRawBody =
    req.is("multipart/form-data") &&
    Buffer.isBuffer(req.rawBody) &&
    (req.readableEnded || req.complete || req.body !== undefined);

  const parseTarget = shouldUseRawBody ? cloneRequestForRawBodyParsing(req) : req;

  return upload(parseTarget, res, (error) => {
    if (!error && parseTarget !== req) {
      req.body = parseTarget.body || req.body;
      req.file = parseTarget.file || req.file;
      req.files = parseTarget.files || req.files;
    }

    if (typeof onAfterParse === "function") {
      return onAfterParse({ error, req, res, next });
    }

    return next(error);
  });
};
